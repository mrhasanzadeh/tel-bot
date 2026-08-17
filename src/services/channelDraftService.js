const crypto = require('crypto');
const shioriApi = require('./shioriApiClient');
const { e, htmlOpts, escapeHtml } = require('../utils/premiumEmoji');
const {
    sendPhotoWithHtmlCaption,
    countCustomEmoji
} = require('../utils/captionEntities');
const {
    getAdminUserIds,
    isAdminUserId,
    getPublishChannelChoices
} = require('../utils/channelIds');

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

/** @typedef {{
 *   coverFileId: string,
 *   captionText: string,
 *   captionEntities: unknown[],
 *   channelId: string,
 *   channelMessageId: number | string | null,
 *   expiresAt: number,
 *   awaitQuery?: boolean
 * }} ForwardActionSession */

/** @type {Map<string, ForwardActionSession>} */
const pendingForwardActions = new Map();

/** admin user id → forward session id (waiting for typed anime name) */
/** @type {Map<string, string>} */
const pendingSearchByAdmin = new Map();

function pruneExpiredBinds() {
    const now = Date.now();
    for (const [id, session] of pendingBinds) {
        if (session.expiresAt <= now) pendingBinds.delete(id);
    }
    for (const [id, session] of pendingForwardActions) {
        if (session.expiresAt <= now) pendingForwardActions.delete(id);
    }
    for (const [adminId, sessionId] of pendingSearchByAdmin) {
        if (!pendingForwardActions.has(sessionId)) {
            pendingSearchByAdmin.delete(adminId);
        }
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
 * @param {import('telegraf/types').Message | undefined} message
 */
function isChannelForwardMessage(message) {
    if (!message) return false;
    if (message.forward_from_chat?.type === 'channel') return true;
    if (message.forward_origin?.type === 'channel') return true;
    return false;
}

/**
 * @param {{ channelId?: string | null }} payload
 */
function resolveChannelId(payload) {
    const config = require('../../config');
    return (
        String(payload?.channelId ?? '').trim() ||
        String(config.PUBLIC_POSTS_CHANNEL_ID || config.ADDITIONAL_CHANNEL_ID || '').trim() ||
        null
    );
}

/**
 * Start bind search/picker from an already-extracted channel post payload.
 * @param {import('telegraf').Context} ctx
 * @param {{
 *   coverFileId: string,
 *   captionText: string,
 *   captionEntities: unknown[],
 *   channelId: string | null,
 *   channelMessageId: number | string | null
 * }} payload
 * @param {string} [rawQuery]
 */
async function startBindFromPayload(ctx, payload, rawQuery = '') {
    const channelId = resolveChannelId(payload);
    if (!channelId) {
        await ctx.reply(
            `${e('warning')} کانال مبدأ مشخص نیست. پست را مستقیم از کانال فوروارد کن ` +
                `یا <code>PUBLIC_POSTS_CHANNEL_ID</code> را در env بات ست کن.`,
            htmlOpts()
        );
        return false;
    }

    const query =
        String(rawQuery ?? '').trim() ||
        extractSearchQueryFromCaption(payload.captionText, payload.captionEntities);

    if (!query) {
        await ctx.reply(
            `${e('warning')} عنوان از کپشن استخراج نشد. از دکمه «جستجو با نام» استفاده کن ` +
                `یا:\n<code>/bind_channel_post نام-انیمه</code>`,
            htmlOpts()
        );
        return false;
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

    const rawArg = String(rawQuery ?? '').trim();
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
                        `بعد از افزودن قسمت، از پنل دکمه «پیش‌نویس کانال» را بزن.`,
                    htmlOpts()
                );
                return true;
            }
        } catch (error) {
            console.warn('bind direct lookup failed, showing picker:', error.message);
        }
    }

    try {
        await sendSearchResults(ctx, session, bindId);
        return true;
    } catch (error) {
        pendingBinds.delete(bindId);
        console.error('bind search error:', error);
        await ctx.reply(
            `${e('error')} خطا در جستجو: ${escapeHtml(error.message)}`,
            htmlOpts()
        );
        return false;
    }
}

/**
 * Auto menu when admin forwards a channel post into the bot DM.
 * @param {import('telegraf').Context} ctx
 * @returns {Promise<boolean>}
 */
async function offerAdminForwardActions(ctx) {
    if (!isAdminUserId(ctx.from?.id)) return false;
    if (ctx.chat?.type !== 'private') return false;

    const message = ctx.message;
    if (!isChannelForwardMessage(message)) return false;

    const payload = extractChannelPostPayload(message);
    if (!payload) return false;

    const channelId = resolveChannelId(payload);
    if (!channelId) {
        await ctx.reply(
            `${e('warning')} کانال مبدأ مشخص نیست. پست را مستقیم از کانال فوروارد کن.`,
            htmlOpts()
        );
        return true;
    }

    pruneExpiredBinds();
    const sessionId = createBindId();
    pendingForwardActions.set(sessionId, {
        coverFileId: payload.coverFileId,
        captionText: payload.captionText,
        captionEntities: payload.captionEntities,
        channelId,
        channelMessageId: payload.channelMessageId,
        expiresAt: Date.now() + BIND_TTL_MS,
        awaitQuery: false
    });

    const hint = extractSearchQueryFromCaption(
        payload.captionText,
        payload.captionEntities
    );

    await ctx.reply(
        `${e('clipboard')} <b>پست کانال دریافت شد</b>\n` +
            (hint
                ? `عنوان پیشنهادی: <code>${escapeHtml(hint)}</code>\n`
                : '') +
            `یکی از گزینه‌ها را انتخاب کن:`,
        {
            ...htmlOpts(),
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '🔗 وصل قالب به انیمه',
                            callback_data: `af:bind:${sessionId}`
                        }
                    ],
                    [
                        {
                            text: '🔎 جستجو با نام…',
                            callback_data: `af:search:${sessionId}`
                        }
                    ],
                    [
                        {
                            text: '🧹 خالی کردن صف پیش‌نویس',
                            callback_data: 'af:clearq'
                        },
                        {
                            text: '⚡ ارسال فوری صف',
                            callback_data: 'af:flushq'
                        }
                    ],
                    [
                        {
                            text: '🆔 شناسه کانال',
                            callback_data: `af:cid:${sessionId}`
                        },
                        {
                            text: '❌ بستن',
                            callback_data: `af:close:${sessionId}`
                        }
                    ]
                ]
            }
        }
    );
    return true;
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {string} action
 * @param {string} [sessionId]
 */
async function handleAdminForwardAction(ctx, action, sessionId) {
    if (!isAdminUserId(ctx.from?.id)) {
        await ctx.answerCbQuery('فقط ادمین.', { show_alert: true });
        return;
    }

    pruneExpiredBinds();

    if (action === 'clearq') {
        await ctx.answerCbQuery('در حال پاک‌سازی...');
        try {
            await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        } catch {
            /* ignore */
        }
        await handleClearChannelDrafts(ctx);
        return;
    }

    if (action === 'flushq') {
        await ctx.answerCbQuery('در حال ارسال صف...');
        try {
            await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        } catch {
            /* ignore */
        }
        await handleFlushChannelDrafts({ telegram: ctx.telegram }, ctx);
        return;
    }

    const session = sessionId ? pendingForwardActions.get(sessionId) : null;
    if (!session) {
        await ctx.answerCbQuery('منقضی شده — پست را دوباره فوروارد کن.', {
            show_alert: true
        });
        return;
    }

    if (action === 'close') {
        pendingForwardActions.delete(sessionId);
        pendingSearchByAdmin.delete(String(ctx.from.id));
        await ctx.answerCbQuery('بسته شد');
        try {
            await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        } catch {
            /* ignore */
        }
        return;
    }

    if (action === 'cid') {
        await ctx.answerCbQuery();
        await ctx.reply(
            `کانال مبدأ:\nشناسه: <code>${escapeHtml(String(session.channelId))}</code>\n` +
                (session.channelMessageId != null
                    ? `message_id: <code>${escapeHtml(String(session.channelMessageId))}</code>\n`
                    : '') +
                `\nدر .env می‌توانی استفاده کنی:\n` +
                `<code>PUBLIC_POSTS_CHANNEL_ID=${escapeHtml(String(session.channelId))}</code>`,
            htmlOpts()
        );
        return;
    }

    if (action === 'search') {
        session.awaitQuery = true;
        session.expiresAt = Date.now() + BIND_TTL_MS;
        pendingSearchByAdmin.set(String(ctx.from.id), sessionId);
        await ctx.answerCbQuery();
        await ctx.reply(
            `${e('search')} نام یا slug انیمه را همین‌جا بفرست (مثلاً <code>dandadan</code>).`,
            htmlOpts()
        );
        return;
    }

    if (action === 'bind') {
        await ctx.answerCbQuery('در حال جستجو...');
        try {
            await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        } catch {
            /* ignore */
        }
        const ok = await startBindFromPayload(ctx, session);
        if (ok) {
            pendingForwardActions.delete(sessionId);
            pendingSearchByAdmin.delete(String(ctx.from.id));
        }
        return;
    }

    await ctx.answerCbQuery('اکشن ناشناخته', { show_alert: true });
}

/**
 * If admin typed an anime name after tapping «جستجو با نام».
 * @param {import('telegraf').Context} ctx
 * @returns {Promise<boolean>}
 */
async function handleAdminPendingSearchQuery(ctx) {
    if (!isAdminUserId(ctx.from?.id)) return false;
    if (ctx.chat?.type !== 'private') return false;

    const raw = String(ctx.message?.text ?? '').trim();
    if (!raw || raw.startsWith('/')) return false;

    pruneExpiredBinds();
    const adminKey = String(ctx.from.id);
    const sessionId = pendingSearchByAdmin.get(adminKey);
    if (!sessionId) return false;

    const session = pendingForwardActions.get(sessionId);
    if (!session || !session.awaitQuery) {
        pendingSearchByAdmin.delete(adminKey);
        return false;
    }

    pendingSearchByAdmin.delete(adminKey);
    session.awaitQuery = false;
    const ok = await startBindFromPayload(ctx, session, raw);
    if (ok) pendingForwardActions.delete(sessionId);
    return true;
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
                `دوباره با کوئری دقیق‌تر امتحان کن یا از دکمه «جستجو با نام» استفاده کن.`,
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
    if (!isAdminUserId(ctx.from?.id)) {
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
                `پست کانال را به اینجا فوروارد کن — منوی دکمه‌ای می‌آید.\n` +
                `یا روی پیام فوروارد ریپلای بزن:\n` +
                `<code>/bind_channel_post</code>\n` +
                `یا با کوئری:\n` +
                `<code>/bind_channel_post dandadan</code>`,
            htmlOpts()
        );
        return;
    }

    await startBindFromPayload(ctx, payload, rawArg);
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {string} bindId
 * @param {string} animeId
 */
async function handleBindPickCallback(ctx, bindId, animeId) {
    if (!isAdminUserId(ctx.from?.id)) {
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
                `بعد از افزودن قسمت، از پنل دکمه «پیش‌نویس کانال» را بزن.`,
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
    if (!isAdminUserId(ctx.from?.id)) {
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
    if (!isAdminUserId(ctx.from?.id)) {
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
 * Admin preview keyboard: one button per publish target + reject + mini-app.
 * @param {string} draftId
 * @param {string} animeId
 */
function buildDraftPreviewKeyboard(draftId, animeId) {
    const channels = getPublishChannelChoices();
    /** @type {Array<Array<{ text: string, callback_data?: string, url?: string }>>} */
    const rows = [];

    if (channels.length === 0) {
        rows.push([
            {
                text: 'انتشار (کانال تنظیم نشده)',
                callback_data: `chdraft_ok_${draftId}`
            }
        ]);
    } else if (channels.length === 1) {
        rows.push([
            {
                text: `ارسال به ${channels[0].label}`,
                callback_data: `chdraft_ch_${draftId}_0`
            }
        ]);
    } else {
        for (let i = 0; i < channels.length; i++) {
            const ch = channels[i];
            rows.push([
                {
                    text: `ارسال به ${ch.label}`,
                    callback_data: `chdraft_ch_${draftId}_${i}`
                }
            ]);
        }
    }

    rows.push([{ text: 'رد', callback_data: `chdraft_no_${draftId}` }]);

    const { buildAnimeEpisodesMiniAppUrl } = require('../utils/miniAppLinks');
    const miniUrl = buildAnimeEpisodesMiniAppUrl(animeId);
    if (miniUrl) {
        rows.push([
            {
                text: 'دانلود از مینی‌اپ',
                url: miniUrl
            }
        ]);
    }

    return { inline_keyboard: rows };
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {string} draftId
 * @param {'publish' | 'reject'} action
 * @param {string} [channelIdOverride]
 */
async function handleChannelDraftCallback(ctx, draftId, action, channelIdOverride) {
    if (!isAdminUserId(ctx.from?.id)) {
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

        const channels = getPublishChannelChoices();
        let channelId = String(channelIdOverride ?? '').trim();

        if (!channelId) {
            if (channels.length === 1) {
                channelId = channels[0].id;
            } else if (channels.length > 1) {
                await ctx.editMessageReplyMarkup({
                    inline_keyboard: channels.map((ch, i) => [
                        {
                            text: `ارسال به ${ch.label}`,
                            callback_data: `chdraft_ch_${draftId}_${i}`
                        }
                    ]).concat([[{ text: 'رد', callback_data: `chdraft_no_${draftId}` }]])
                });
                await ctx.reply(
                    `${e('info')} کانال مقصد را از دکمه‌های زیر پیش‌نمایش انتخاب کن.`,
                    htmlOpts()
                );
                return;
            }
        }

        const prepared = await shioriApi.post(
            `/bot/channel-drafts/${encodeURIComponent(draftId)}/publish`,
            channelId ? { channel_id: channelId } : {}
        );

        if (prepared?.already_published) {
            await ctx.reply(`${e('info')} قبلاً منتشر شده بود.`, htmlOpts());
            return;
        }

        if (!prepared?.needs_bot_send) {
            throw new Error('publish payload missing needs_bot_send');
        }

        const targetChannelId = String(prepared.channel_id || channelId || '').trim();
        const cover = prepared.cover_file_id;
        const caption = prepared.caption;
        if (!targetChannelId || !cover || !caption) {
            throw new Error('publish payload incomplete');
        }

        const sent = await ctx.telegram.sendPhoto(targetChannelId, cover, {
            caption,
            parse_mode: 'HTML',
            reply_markup: prepared.reply_markup || undefined
        });

        const messageId = sent?.message_id ?? null;
        console.log(`📋 channel draft published draft=${draftId} msg=${messageId}`);

        if (!messageId) {
            throw new Error('sendPhoto returned no message_id');
        }

        await shioriApi.post(
            `/bot/channel-drafts/${encodeURIComponent(draftId)}/mark-published`,
            {
                published_message_id: messageId,
                channel_id: targetChannelId
            }
        );

        const label =
            channels.find((c) => c.id === targetChannelId)?.label || targetChannelId;

        await ctx.reply(
            `${e('success')} منتشر شد در <b>${escapeHtml(label)}</b>.\n` +
                `message_id: <code>${escapeHtml(String(messageId))}</code>\n` +
                `${e('info')} کپشن را در کانال ادیت کن و متن پیش‌نمایش را جایگزین کن تا اموجی پرمیوم حفظ شود.`,
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
 * @param {import('telegraf').Context} ctx
 * @param {string} draftId
 * @param {number} channelIndex
 */
async function handleChannelDraftPublishTo(ctx, draftId, channelIndex) {
    const channels = getPublishChannelChoices();
    const ch = channels[channelIndex];
    if (!ch) {
        await ctx.answerCbQuery('کانال نامعتبر.', { show_alert: true });
        return;
    }
    await handleChannelDraftCallback(ctx, draftId, 'publish', ch.id);
}

/**
 * Deliver queued channel-draft previews (API cannot reach Telegram on this host).
 * @param {import('telegraf').Telegraf} bot
 */
async function deliverPendingChannelDraftPreviews(bot) {
    const adminIds = getAdminUserIds();
    if (!adminIds.length) {
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

        const fromApi = Array.isArray(item.admin_user_ids)
            ? item.admin_user_ids.map((id) => String(id).trim()).filter(Boolean)
            : [];
        const targets = [...new Set(fromApi.length ? fromApi : adminIds)];

        if (!draftId || !cover || !caption || !targets.length) {
            console.warn(
                `📋 skip draft=${draftId || '?'} missing fields cover=${Boolean(cover)} caption=${Boolean(caption)} targets=${targets.length}`
            );
            if (draftId) {
                try {
                    await shioriApi.post(
                        `/bot/channel-drafts/${encodeURIComponent(draftId)}/reject`
                    );
                    console.warn(`📋 rejected incomplete draft=${draftId}`);
                } catch (rejectErr) {
                    console.warn(
                        `📋 could not reject incomplete draft=${draftId}:`,
                        rejectErr instanceof Error ? rejectErr.message : rejectErr
                    );
                }
            }
            continue;
        }

        try {
            /** @type {{ chatId: string, messageId: number } | null} */
            let ack = null;
            const errors = [];

            for (const chatId of targets) {
                try {
                    await bot.telegram.sendMessage(
                        chatId,
                        `پیش‌نویس پست کانال\n` +
                            `<b>${escapeHtml(String(item.anime_title || ''))}</b> — قسمت ${escapeHtml(String(item.episode_number ?? ''))}\n` +
                            `کانال مقصد را از دکمه‌های زیر عکس انتخاب کن.`,
                        htmlOpts()
                    );

                    const previewKeyboard = buildDraftPreviewKeyboard(
                        draftId,
                        String(item.anime_id || '')
                    );

                    const preview = await sendPhotoWithHtmlCaption(
                        bot.telegram,
                        chatId,
                        cover,
                        caption,
                        { reply_markup: previewKeyboard }
                    );

                    const messageId = preview?.message_id;
                    if (messageId && !ack) {
                        ack = { chatId, messageId };
                    }
                    console.log(
                        `📋 Channel draft preview delivered draft=${draftId} → ${chatId} ` +
                            `custom_emoji=${countCustomEmoji(preview?.caption_entities)}`
                    );
                } catch (sendErr) {
                    const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
                    errors.push(`${chatId}: ${msg}`);
                    console.warn(
                        `📋 preview send failed draft=${draftId} chat=${chatId}: ${msg}`
                    );
                }
            }

            if (!ack) {
                console.warn(
                    `📋 preview send failed for all admins draft=${draftId}: ${errors.join('; ')}`
                );
                try {
                    await shioriApi.post(
                        `/bot/channel-drafts/${encodeURIComponent(draftId)}/reject`
                    );
                } catch (_) {
                    /* ignore */
                }
                continue;
            }

            await shioriApi.post(
                `/bot/channel-drafts/${encodeURIComponent(draftId)}/ack-preview`,
                { chat_id: ack.chatId, message_id: ack.messageId }
            );
        } catch (error) {
            console.error(`📋 channel draft preview failed draft=${draftId}:`, error.message);
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
        `📋 Channel draft preview poller started (${intervalMs}ms) admins=${getAdminUserIds().join(',') || 'MISSING'}`
    );
    return timer;
}

/**
 * Admin: reject all pending drafts still waiting for preview.
 * @param {import('telegraf').Context} ctx
 */
async function handleClearChannelDrafts(ctx) {
    if (!isAdminUserId(ctx.from?.id)) {
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
    if (!isAdminUserId(ctx.from?.id)) {
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
    handleChannelDraftPublishTo,
    handleClearChannelDrafts,
    handleFlushChannelDrafts,
    offerAdminForwardActions,
    handleAdminForwardAction,
    handleAdminPendingSearchQuery,
    deliverPendingChannelDraftPreviews,
    startChannelDraftPreviewPoller,
    extractChannelPostPayload,
    extractSearchQueryFromCaption,
    isChannelForwardMessage
};
