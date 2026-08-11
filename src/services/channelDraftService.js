const crypto = require('crypto');
const shioriApi = require('./shioriApiClient');
const { e, htmlOpts, escapeHtml } = require('../utils/premiumEmoji');
const { channelCaptionOpts } = require('../utils/captionEntities');
const { getAdminUserId } = require('../utils/channelIds');

/** @typedef {{
 *   coverFileId: string,
 *   captionText: string,
 *   captionEntities: unknown[],
 *   channelId: string,
 *   channelMessageId: number | string | null,
 *   query: string,
 *   expiresAt: number
 * }} BindSession */

const BIND_TTL_MS = 10 * 60 * 1000;
/** @type {Map<string, BindSession>} */
const pendingBinds = new Map();

function pruneExpiredBinds() {
    const now = Date.now();
    for (const [id, session] of pendingBinds) {
        if (session.expiresAt <= now) pendingBinds.delete(id);
    }
}

function createBindId() {
    return crypto.randomBytes(4).toString('hex');
}

/**
 * Prefer first bold entity text; else first non-empty caption line.
 * @param {string} captionText
 * @param {Array<{ type?: string, offset?: number, length?: number }> | undefined} entities
 */
function extractSearchQueryFromCaption(captionText, entities = []) {
    const text = String(captionText ?? '');
    const bold = (entities || []).find(
        (ent) => ent?.type === 'bold' || ent?.type === 'strong'
    );
    if (
        bold &&
        Number.isFinite(bold.offset) &&
        Number.isFinite(bold.length) &&
        bold.length > 0
    ) {
        const slice = text.slice(bold.offset, bold.offset + bold.length).trim();
        if (slice) return slice.slice(0, 80);
    }

    const firstLine = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
    return firstLine ? firstLine.slice(0, 80) : '';
}

/**
 * Extract photo file_id + caption from a message (or its reply / forward).
 * Supports classic forward_from_chat and Bot API 7+ forward_origin.
 * @param {import('telegraf/types').Message | undefined} message
 */
function extractChannelPostPayload(message) {
    if (!message) return null;

    const photos = message.photo;
    const photoFileId =
        Array.isArray(photos) && photos.length > 0
            ? photos[photos.length - 1].file_id
            : message.document?.mime_type?.startsWith('image/')
              ? message.document.file_id
              : null;

    const captionText = message.caption || message.text || '';
    const captionEntities = message.caption_entities || message.entities || [];

    const origin = message.forward_origin;
    const originChannelId =
        origin?.type === 'channel' && origin.chat?.id != null
            ? String(origin.chat.id)
            : origin?.type === 'channel' && origin.chat_id != null
              ? String(origin.chat_id)
              : null;
    const originMessageId =
        origin?.type === 'channel' && origin.message_id != null
            ? origin.message_id
            : null;

    const channelId =
        message.forward_from_chat?.id != null
            ? String(message.forward_from_chat.id)
            : originChannelId != null
              ? originChannelId
              : message.chat?.type === 'channel'
                ? String(message.chat.id)
                : null;

    const channelMessageId =
        message.forward_from_message_id != null
            ? message.forward_from_message_id
            : originMessageId != null
              ? originMessageId
              : message.message_id;

    if (!photoFileId || !captionText.trim()) return null;

    return {
        coverFileId: photoFileId,
        captionText,
        captionEntities,
        channelId,
        channelMessageId
    };
}

/**
 * @param {BindSession} session
 * @param {string} animeIdOrSlug
 */
async function putChannelTemplate(session, animeIdOrSlug) {
    return shioriApi.put(
        `/bot/anime/${encodeURIComponent(animeIdOrSlug)}/channel-template`,
        {
            cover_file_id: session.coverFileId,
            caption_text: session.captionText,
            caption_entities: session.captionEntities,
            channel_id: session.channelId,
            channel_message_id: session.channelMessageId
        }
    );
}

/**
 * @param {string} bindId
 * @param {Array<{ id: string, slug?: string | null, title?: string | null, year?: number | null, has_channel_template?: boolean }>} items
 */
function buildSearchKeyboard(bindId, items) {
    /** @type {import('telegraf/types').InlineKeyboardButton[][]} */
    const rows = items.map((item) => {
        const year = item.year != null ? ` (${item.year})` : '';
        const bound = item.has_channel_template ? ' ✓' : '';
        const label = `${String(item.title || item.slug || item.id).slice(0, 48)}${year}${bound}`;
        // callback_data max 64 bytes: bp:{8hex}:{uuid} ≈ 48
        return [
            {
                text: label,
                callback_data: `bp:${bindId}:${item.id}`
            }
        ];
    });

    rows.push([
        { text: '↻ جستجوی دوباره', callback_data: `br:${bindId}` },
        { text: '❌ لغو', callback_data: `bc:${bindId}` }
    ]);

    return { inline_keyboard: rows };
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {BindSession} session
 * @param {string} bindId
 */
async function sendSearchResults(ctx, session, bindId) {
    const q = encodeURIComponent(session.query);
    const data = await shioriApi.get(`/bot/anime/search?q=${q}&limit=8`);
    const items = Array.isArray(data?.items) ? data.items : [];

    if (!items.length) {
        await ctx.reply(
            `${e('warning')} نتیجه‌ای برای «${escapeHtml(session.query)}» پیدا نشد.\n` +
                `دوباره با کوئری دقیق‌تر امتحان کن:\n` +
                `<code>/bind_channel_post نام-یا-slug</code>`,
            htmlOpts()
        );
        return;
    }

    await ctx.reply(
        `${e('search')} <b>${items.length}</b> نتیجه برای «${escapeHtml(session.query)}»\n` +
            `یکی را انتخاب کن تا قالب کانال به آن وصل شود:`,
        {
            ...htmlOpts(),
            reply_markup: buildSearchKeyboard(bindId, items)
        }
    );
}

/**
 * /bind_channel_post [query] — reply to a forwarded channel post.
 * Without query: extract title from caption and show search picker.
 * With query that looks like an exact slug/id: still search; if single exact
 * slug match is preferred via picker (or direct bind when query equals slug uniquely).
 * @param {import('telegraf').Context} ctx
 */
async function handleBindChannelPost(ctx) {
    const adminId = getAdminUserId();
    if (String(ctx.from?.id) !== String(adminId)) {
        await ctx.reply(`${e('error')} این دستور فقط برای ادمین است.`, htmlOpts());
        return;
    }

    const parts = String(ctx.message?.text ?? '')
        .trim()
        .split(/\s+/);
    // Strip @BotName if Telegram appended it to the command entity.
    const rawArg = parts.slice(1).join(' ').replace(/@[\w]+$/i, '').trim();

    const source = ctx.message?.reply_to_message;
    const payload = extractChannelPostPayload(source);
    if (!payload) {
        await ctx.reply(
            `${e('clipboard')} <b>راهنما</b>\n` +
                `۱) آخرین پست کانال را به اینجا فوروارد کن\n` +
                `۲) روی همان پیام ریپلای بزن:\n` +
                `<code>/bind_channel_post</code>\n` +
                `یا با کوئری:\n` +
                `<code>/bind_channel_post dandadan</code>`,
            htmlOpts()
        );
        return;
    }

    const config = require('../../config');
    const channelId =
        payload.channelId ||
        String(config.PUBLIC_POSTS_CHANNEL_ID || config.ADDITIONAL_CHANNEL_ID || '').trim() ||
        null;

    if (!channelId) {
        await ctx.reply(
            `${e('warning')} کانال مبدأ مشخص نیست. پست را مستقیم از کانال فوروارد کن ` +
                `یا <code>PUBLIC_POSTS_CHANNEL_ID</code> را در env بات ست کن.`,
            htmlOpts()
        );
        return;
    }

    const query =
        rawArg ||
        extractSearchQueryFromCaption(payload.captionText, payload.captionEntities);

    if (!query) {
        await ctx.reply(
            `${e('warning')} عنوان از کپشن استخراج نشد. کوئری بده:\n` +
                `<code>/bind_channel_post نام-انیمه</code>`,
            htmlOpts()
        );
        return;
    }

    pruneExpiredBinds();
    const bindId = createBindId();
    /** @type {BindSession} */
    const session = {
        coverFileId: payload.coverFileId,
        captionText: payload.captionText,
        captionEntities: payload.captionEntities,
        channelId,
        channelMessageId: payload.channelMessageId,
        query,
        expiresAt: Date.now() + BIND_TTL_MS
    };
    pendingBinds.set(bindId, session);

    // Backward-compatible: if arg looks like a known slug/id, try direct bind first.
    if (rawArg && !/\s/.test(rawArg)) {
        try {
            const search = await shioriApi.get(
                `/bot/anime/search?q=${encodeURIComponent(rawArg)}&limit=8`
            );
            const items = Array.isArray(search?.items) ? search.items : [];
            const exact = items.find(
                (it) =>
                    String(it.slug || '').toLowerCase() === rawArg.toLowerCase() ||
                    String(it.id || '').toLowerCase() === rawArg.toLowerCase()
            );

            if (exact && items.length === 1) {
                const result = await putChannelTemplate(session, exact.id);
                pendingBinds.delete(bindId);
                await ctx.reply(
                    `${e('success')} قالب کانال ذخیره شد.\n` +
                        `<b>${escapeHtml(result?.title || exact.title || rawArg)}</b>\n` +
                        `slug: <code>${escapeHtml(result?.slug || exact.slug || rawArg)}</code>\n` +
                        `از این به بعد با افزودن قسمت در پنل، پیش‌نویس برایت می‌آید.`,
                    htmlOpts()
                );
                return;
            }
        } catch (error) {
            // Fall through to picker / error below
            console.warn('bind direct lookup failed, showing picker:', error.message);
        }
    }

    try {
        await sendSearchResults(ctx, session, bindId);
    } catch (error) {
        pendingBinds.delete(bindId);
        console.error('bind_channel_post search error:', error);
        await ctx.reply(
            `${e('error')} خطا در جستجو: ${escapeHtml(error.message)}`,
            htmlOpts()
        );
    }
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {string} bindId
 * @param {string} animeId
 */
async function handleBindPickCallback(ctx, bindId, animeId) {
    const adminId = getAdminUserId();
    if (String(ctx.from?.id) !== String(adminId)) {
        await ctx.answerCbQuery('فقط ادمین.', { show_alert: true });
        return;
    }

    pruneExpiredBinds();
    const session = pendingBinds.get(bindId);
    if (!session) {
        await ctx.answerCbQuery('منقضی شده — دوباره /bind_channel_post بزن.', {
            show_alert: true
        });
        return;
    }

    await ctx.answerCbQuery('در حال ذخیره...');

    try {
        const result = await putChannelTemplate(session, animeId);
        pendingBinds.delete(bindId);

        try {
            await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        } catch {
            /* ignore */
        }

        await ctx.reply(
            `${e('success')} قالب کانال ذخیره شد.\n` +
                `<b>${escapeHtml(result?.title || animeId)}</b>\n` +
                `slug: <code>${escapeHtml(result?.slug || '')}</code>\n` +
                `از این به بعد با افزودن قسمت در پنل، پیش‌نویس برایت می‌آید.`,
            htmlOpts()
        );
    } catch (error) {
        console.error('bind_pick error:', error);
        await ctx.reply(
            `${e('error')} خطا در ذخیره قالب: ${escapeHtml(error.message)}`,
            htmlOpts()
        );
    }
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {string} bindId
 */
async function handleBindRetryCallback(ctx, bindId) {
    const adminId = getAdminUserId();
    if (String(ctx.from?.id) !== String(adminId)) {
        await ctx.answerCbQuery('فقط ادمین.', { show_alert: true });
        return;
    }

    pruneExpiredBinds();
    const session = pendingBinds.get(bindId);
    if (!session) {
        await ctx.answerCbQuery('منقضی شده — دوباره /bind_channel_post بزن.', {
            show_alert: true
        });
        return;
    }

    session.expiresAt = Date.now() + BIND_TTL_MS;
    await ctx.answerCbQuery('جستجوی دوباره...');

    try {
        const q = encodeURIComponent(session.query);
        const data = await shioriApi.get(`/bot/anime/search?q=${q}&limit=8`);
        const items = Array.isArray(data?.items) ? data.items : [];
        if (!items.length) {
            await ctx.answerCbQuery('نتیجه‌ای نبود.', { show_alert: true });
            return;
        }
        await ctx.editMessageReplyMarkup(buildSearchKeyboard(bindId, items));
    } catch (error) {
        console.error('bind_retry error:', error);
        await ctx.reply(
            `${e('error')} خطا در جستجو: ${escapeHtml(error.message)}`,
            htmlOpts()
        );
    }
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {string} bindId
 */
async function handleBindCancelCallback(ctx, bindId) {
    const adminId = getAdminUserId();
    if (String(ctx.from?.id) !== String(adminId)) {
        await ctx.answerCbQuery('فقط ادمین.', { show_alert: true });
        return;
    }

    pendingBinds.delete(bindId);
    await ctx.answerCbQuery('لغو شد');
    try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch {
        /* ignore */
    }
    await ctx.reply(`${e('stop')} بایند لغو شد.`, htmlOpts());
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {string} draftId
 * @param {'publish' | 'reject'} action
 */
async function handleChannelDraftCallback(ctx, draftId, action) {
    const adminId = getAdminUserId();
    if (String(ctx.from?.id) !== String(adminId)) {
        await ctx.answerCbQuery('فقط ادمین.', { show_alert: true });
        return;
    }

    await ctx.answerCbQuery(action === 'publish' ? 'در حال انتشار...' : 'رد شد');

    try {
        try {
            await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        } catch {
            /* ignore */
        }

        if (action === 'reject') {
            await shioriApi.post(`/bot/channel-drafts/${encodeURIComponent(draftId)}/reject`);
            await ctx.reply(`${e('stop')} پیش‌نویس رد شد.`, htmlOpts());
            return;
        }

        const prepared = await shioriApi.post(
            `/bot/channel-drafts/${encodeURIComponent(draftId)}/publish`
        );

        if (prepared?.already_published) {
            await ctx.reply(`${e('info')} قبلاً منتشر شده بود.`, htmlOpts());
            return;
        }

        if (!prepared?.needs_bot_send) {
            throw new Error('publish payload missing needs_bot_send');
        }

        const channelId = prepared.channel_id;
        const cover = prepared.cover_file_id;
        const caption = prepared.caption;
        if (!channelId || !cover || !caption) {
            throw new Error('publish payload incomplete');
        }

        const sent = await ctx.telegram.sendPhoto(channelId, cover, {
            ...channelCaptionOpts(caption),
            reply_markup: prepared.reply_markup || undefined
        });

        const messageId = sent?.message_id;
        if (!messageId) {
            throw new Error('sendPhoto returned no message_id');
        }

        await shioriApi.post(
            `/bot/channel-drafts/${encodeURIComponent(draftId)}/mark-published`,
            {
                published_message_id: messageId,
                channel_id: channelId
            }
        );

        await ctx.reply(
            `${e('success')} منتشر شد.\n` +
                `message_id: <code>${escapeHtml(String(messageId))}</code>`,
            htmlOpts()
        );
    } catch (error) {
        console.error('channel draft callback error:', error);
        await ctx.reply(
            `${e('error')} خطا: ${escapeHtml(error.message)}`,
            htmlOpts()
        );
    }
}

/**
 * Deliver queued channel-draft previews (API cannot reach Telegram on this host).
 * @param {import('telegraf').Telegraf} bot
 */
async function deliverPendingChannelDraftPreviews(bot) {
    const adminId = getAdminUserId();
    if (!adminId) {
        console.warn(
            '📋 Channel draft poller: ADMIN_USER_ID missing on tel-bot — cannot DM previews'
        );
        return;
    }

    let data;
    try {
        data = await shioriApi.get('/bot/channel-drafts/pending-preview?limit=5');
    } catch (error) {
        console.warn('📋 pending-preview poll failed:', error.message);
        return;
    }

    if (data == null) {
        console.warn(
            '📋 pending-preview returned 404/empty — deploy latest api.shiori.cloud (channel-drafts/pending-preview)'
        );
        return;
    }

    const items = Array.isArray(data?.items) ? data.items : [];
    if (!items.length) return;

    console.log(`📋 Channel draft poller: ${items.length} pending preview(s)`);

    for (const item of items) {
        const draftId = item.id;
        const cover = item.cover_file_id;
        const caption = item.proposed_caption;
        const chatId = String(
            item.admin_user_id || item.admin_preview_chat_id || adminId
        ).trim();
        if (!draftId || !cover || !caption || !chatId) {
            console.warn(
                `📋 skip draft=${draftId || '?'} missing fields cover=${Boolean(cover)} caption=${Boolean(caption)} chat=${chatId}`
            );
            continue;
        }

        try {
            await bot.telegram.sendMessage(
                chatId,
                `پیش‌نویس پست کانال\n` +
                    `<b>${escapeHtml(String(item.anime_title || ''))}</b> — قسمت ${escapeHtml(String(item.episode_number ?? ''))}\n` +
                    `تأیید → انتشار در کانال`,
                htmlOpts()
            );

            /** @type {import('telegraf/types').Message.PhotoMessage | undefined} */
            let preview;
            try {
                preview = await bot.telegram.sendPhoto(chatId, cover, {
                    ...channelCaptionOpts(caption),
                    reply_markup: item.draft_keyboard || undefined
                });
            } catch (photoErr) {
                // Caption too long / entity issue — send photo + caption separately
                console.warn(
                    `📋 sendPhoto+caption failed draft=${draftId}: ${photoErr.message}; retrying split`
                );
                preview = await bot.telegram.sendPhoto(chatId, cover, {
                    reply_markup: item.draft_keyboard || undefined
                });
                const textPayload = channelCaptionOpts(caption);
                await bot.telegram.sendMessage(chatId, textPayload.caption, {
                    entities: textPayload.caption_entities,
                    disable_web_page_preview: true,
                    reply_markup: item.draft_keyboard || undefined
                });
            }

            const messageId = preview?.message_id;
            if (!messageId) {
                console.warn(`📋 preview send missing message_id draft=${draftId}`);
                continue;
            }

            await shioriApi.post(
                `/bot/channel-drafts/${encodeURIComponent(draftId)}/ack-preview`,
                { chat_id: chatId, message_id: messageId }
            );
            console.log(`📋 Channel draft preview delivered draft=${draftId} → ${chatId}`);
        } catch (error) {
            console.error(`📋 channel draft preview failed draft=${draftId}:`, error.message);
            // Drop from queue so one bad draft cannot block forever
            try {
                await shioriApi.post(
                    `/bot/channel-drafts/${encodeURIComponent(draftId)}/reject`
                );
                console.warn(`📋 rejected stuck draft=${draftId} after preview failure`);
            } catch (rejectErr) {
                console.warn(
                    `📋 could not reject draft=${draftId}:`,
                    rejectErr instanceof Error ? rejectErr.message : rejectErr
                );
            }
        }
    }
}

/**
 * @param {import('telegraf').Telegraf} bot
 * @param {number} [intervalMs]
 */
function startChannelDraftPreviewPoller(bot, intervalMs = 5_000) {
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try {
            await deliverPendingChannelDraftPreviews(bot);
        } finally {
            running = false;
        }
    };
    void tick();
    const timer = setInterval(() => {
        void tick();
    }, intervalMs);
    console.log(
        `📋 Channel draft preview poller started (${intervalMs}ms) admin=${getAdminUserId() || 'MISSING'}`
    );
    return timer;
}

/**
 * Admin: reject all pending drafts still waiting for preview.
 * @param {import('telegraf').Context} ctx
 */
async function handleClearChannelDrafts(ctx) {
    const adminId = getAdminUserId();
    if (String(ctx.from?.id) !== String(adminId)) {
        await ctx.reply(`${e('error')} این دستور فقط برای ادمین است.`, htmlOpts());
        return;
    }

    try {
        const result = await shioriApi.post('/bot/channel-drafts/clear-pending');
        const cleared = Number(result?.cleared ?? 0);
        await ctx.reply(
            `${e('success')} صف پیش‌نویس پاک شد.\n` +
                `رد شده: <code>${cleared}</code>`,
            htmlOpts()
        );
    } catch (error) {
        console.error('clear_channel_drafts error:', error);
        await ctx.reply(
            `${e('error')} خطا: ${escapeHtml(error.message)}`,
            htmlOpts()
        );
    }
}

/**
 * Admin: immediately poll and deliver pending previews.
 * @param {import('telegraf').Telegraf} bot
 * @param {import('telegraf').Context} ctx
 */
async function handleFlushChannelDrafts(bot, ctx) {
    const adminId = getAdminUserId();
    if (String(ctx.from?.id) !== String(adminId)) {
        await ctx.reply(`${e('error')} این دستور فقط برای ادمین است.`, htmlOpts());
        return;
    }

    await ctx.reply(`${e('timer')} در حال ارسال پیش‌نویس‌های در صف...`, htmlOpts());
    try {
        await deliverPendingChannelDraftPreviews(bot);
        await ctx.reply(`${e('success')} فلش صف انجام شد.`, htmlOpts());
    } catch (error) {
        console.error('flush_channel_drafts error:', error);
        await ctx.reply(
            `${e('error')} خطا: ${escapeHtml(error.message)}`,
            htmlOpts()
        );
    }
}

module.exports = {
    handleBindChannelPost,
    handleBindPickCallback,
    handleBindRetryCallback,
    handleBindCancelCallback,
    handleChannelDraftCallback,
    handleClearChannelDrafts,
    handleFlushChannelDrafts,
    deliverPendingChannelDraftPreviews,
    startChannelDraftPreviewPoller,
    extractChannelPostPayload,
    extractSearchQueryFromCaption
};
