const config = require('../../config');
const { e, htmlOpts, escapeHtml } = require('../utils/premiumEmoji');
const {
    countCustomEmoji,
    htmlToCaptionPayload,
    isBalancedTgEmojiHtml,
    messageEntityOpts,
    messageToHtml,
    sendMessageWithEntities,
    sendMessageWithHtml,
    sendPhotoWithHtmlCaption,
    MESSAGE_TEXT_MAX,
    PHOTO_CAPTION_MAX
} = require('../utils/captionEntities');
const {
    buildMiniAppCtaKeyboard,
    buildMiniAppStartUrl
} = require('../utils/miniAppLinks');
const {
    getPublishChannelChoices,
    isAdminUserId,
    normalizeChatId
} = require('../utils/channelIds');

const SESSION_TTL_MS = 15 * 60 * 1000;

/** @typedef {'content' | 'destination' | 'anime_id' | 'button_label' | 'confirm'} CustomPostStep */

/** @typedef {{
 *   step: CustomPostStep,
 *   photoFileId?: string | null,
 *   text?: string,
 *   entities?: object[],
 *   sourceHtml?: string,
 *   startapp?: string | null,
 *   destinationKey?: string,
 *   buttonText?: string,
 *   previewChatId?: string,
 *   previewMessageId?: number,
 *   expiresAt: number
 * }} CustomChannelPostSession */

/** @type {Map<string, CustomChannelPostSession>} */
const sessions = new Map();

const DESTINATIONS = [
    {
        key: 'home',
        label: 'خانه مینی‌اپ',
        startapp: null,
        defaultButton: 'ورود به مینی‌اپ'
    },
    {
        key: 'schedule',
        label: 'برنامه پخش',
        startapp: 'schedule',
        defaultButton: 'برنامه پخش'
    },
    {
        key: 'subscribe',
        label: 'اشتراک',
        startapp: 'subscribe',
        defaultButton: 'اشتراک شیوری'
    },
    {
        key: 'anime_eps',
        label: 'انیمه → قسمت‌ها',
        startapp: null,
        needsAnimeId: true,
        animeTab: 'episodes',
        defaultButton: 'دانلود از مینی‌اپ'
    },
    {
        key: 'anime_info',
        label: 'انیمه → اطلاعات',
        startapp: null,
        needsAnimeId: true,
        animeTab: 'info',
        defaultButton: 'مشاهده در مینی‌اپ'
    }
];

function pruneSessions() {
    const now = Date.now();
    for (const [adminId, session] of sessions) {
        if (session.expiresAt <= now) sessions.delete(adminId);
    }
}

function getSession(adminId) {
    pruneSessions();
    return sessions.get(String(adminId)) ?? null;
}

function clearSession(adminId) {
    sessions.delete(String(adminId));
}

function touchSession(adminId, patch) {
    const id = String(adminId);
    const prev = getSession(id);
    const next = {
        ...prev,
        ...patch,
        expiresAt: Date.now() + SESSION_TTL_MS
    };
    sessions.set(id, next);
    return next;
}

function hasActiveSession(adminId) {
    return Boolean(getSession(adminId));
}

function getPublishTargets() {
    /** @type {Array<{ id: string, label: string }>} */
    const choices = [...getPublishChannelChoices()];
    const testId = normalizeChatId(config.SCHEDULE_TEST_CHANNEL_ID);
    if (testId && !choices.some((row) => row.id === testId)) {
        choices.unshift({ id: testId, label: 'کانال تست' });
    }
    return choices;
}

function findDestination(key) {
    return DESTINATIONS.find((d) => d.key === key) || null;
}

function buildDestinationKeyboard() {
    const rows = DESTINATIONS.map((d) => [
        { text: d.label, callback_data: `cpost2_dest_${d.key}` }
    ]);
    rows.push([{ text: '❌ لغو', callback_data: 'cpost2_cancel' }]);
    return { inline_keyboard: rows };
}

function buildConfirmKeyboard(session) {
    const channels = getPublishTargets();
    /** @type {Array<Array<object>>} */
    const rows = [];

    const cta = buildMiniAppCtaKeyboard({
        text: session.buttonText,
        startapp: session.startapp
    });
    if (cta?.inline_keyboard?.[0]) {
        rows.push(cta.inline_keyboard[0]);
    }

    if (channels.length === 0) {
        rows.push([{ text: 'انتشار (کانال تنظیم نشده)', callback_data: 'cpost2_pub_0' }]);
    } else {
        for (let i = 0; i < channels.length; i++) {
            rows.push([
                {
                    text: `ارسال به ${channels[i].label}`,
                    callback_data: `cpost2_pub_${i}`
                }
            ]);
        }
    }

    rows.push([{ text: '❌ لغو', callback_data: 'cpost2_cancel' }]);
    return { inline_keyboard: rows };
}

function buildLabelKeyboard(defaultLabel) {
    return {
        inline_keyboard: [
            [
                {
                    text: `استفاده از: ${defaultLabel}`,
                    callback_data: 'cpost2_label_default'
                }
            ],
            [{ text: '❌ لغو', callback_data: 'cpost2_cancel' }]
        ]
    };
}

/** Telegram Bot API: custom_emoji in channels needs Fragment username on the bot. */
const CHANNEL_PREMIUM_EMOJI_NOTE =
    `${e('warning')} <b>اموجی پرمیوم در کانال</b>\n` +
    `طبق API تلگرام، bot فقط در چت خصوصی/گروه می‌تواند اموجی پرمیوم بفرستد؛ ` +
    `در <b>کانال</b> معمولاً به یونیکد تبدیل می‌شود مگر username از Fragment روی bot باشد.`;

/**
 * @param {import('telegraf').Context} ctx
 */
async function handleCustomPostCommand(ctx) {
    if (ctx.chat?.type !== 'private') return;
    if (!isAdminUserId(ctx.from?.id)) {
        await ctx.reply(`${e('error')} این دستور فقط برای ادمین است.`, htmlOpts());
        return;
    }

    const adminId = String(ctx.from.id);
    const parts = String(ctx.message?.text ?? '')
        .trim()
        .split(/\s+/);
    const sub = (parts[1] ?? '').toLowerCase();

    if (sub === 'cancel' || sub === 'لغو') {
        clearSession(adminId);
        await ctx.reply(`${e('stop')} پست کاستوم لغو شد.`, htmlOpts());
        return;
    }

    touchSession(adminId, {
        step: 'content',
        photoFileId: null,
        text: undefined,
        entities: undefined,
        sourceHtml: undefined,
        startapp: undefined,
        destinationKey: undefined,
        buttonText: undefined,
        previewChatId: undefined,
        previewMessageId: undefined
    });

    await ctx.reply(
        `${e('megaphone')} <b>پست جدید کانال + دکمه مینی‌اپ</b>\n\n` +
            `۱) یک <b>عکس</b> (با یا بدون کپشن) یا <b>متن</b> بفرست\n` +
            `۲) مقصد دکمه مینی‌اپ را انتخاب کن\n` +
            `۳) متن دکمه را تأیید یا عوض کن\n` +
            `۴) پیش‌نمایش را ببین و کانال انتشار را بزن\n\n` +
            `لغو: <code>/custom_post cancel</code>`,
        htmlOpts()
    );
}

/**
 * @param {import('telegraf').Context} ctx
 * @returns {Promise<boolean>}
 */
async function handleCustomPostPhoto(ctx) {
    if (ctx.chat?.type !== 'private') return false;
    if (!isAdminUserId(ctx.from?.id)) return false;

    const adminId = String(ctx.from.id);
    const session = getSession(adminId);
    if (!session || session.step !== 'content') return false;

    const photos = ctx.message?.photo;
    if (!Array.isArray(photos) || photos.length === 0) return false;

    const best = photos[photos.length - 1];
    const fileId = String(best?.file_id ?? '').trim();
    if (!fileId) {
        await ctx.reply(`${e('warning')} عکس معتبر نیست.`, htmlOpts());
        return true;
    }

    const caption = String(ctx.message?.caption ?? '').trim();
    const sourceEntities = ctx.message?.caption_entities ?? [];
    if (caption.length > PHOTO_CAPTION_MAX) {
        await ctx.reply(
            `${e('warning')} کپشن عکس حداکثر ${PHOTO_CAPTION_MAX} کاراکتر است.`,
            htmlOpts()
        );
        return true;
    }

    const payload = caption
        ? messageEntityOpts(caption, sourceEntities)
        : { text: '', entities: [] };
    const sourceHtml = caption && /<tg-emoji\b/i.test(caption) ? caption : undefined;

    touchSession(adminId, {
        step: 'destination',
        photoFileId: fileId,
        text: payload.text || '',
        entities: payload.entities || [],
        sourceHtml
    });

    await ctx.reply(
        `${e('success')} عکس ثبت شد.` +
            (caption ? ` کپشن: ${caption.length} کاراکتر.` : ' بدون کپشن.') +
            `\n\nمقصد دکمه مینی‌اپ را انتخاب کن:`,
        { ...htmlOpts(), reply_markup: buildDestinationKeyboard() }
    );
    return true;
}

/**
 * @param {import('telegraf').Context} ctx
 * @returns {Promise<boolean>}
 */
async function handleCustomPostText(ctx) {
    if (ctx.chat?.type !== 'private') return false;
    if (!isAdminUserId(ctx.from?.id)) return false;

    const adminId = String(ctx.from.id);
    const session = getSession(adminId);
    if (!session) return false;

    const text = String(ctx.message?.text ?? '').trim();
    if (!text || text.startsWith('/')) return false;

    if (session.step === 'content') {
        const sourceEntities = ctx.message?.entities ?? [];
        if (text.length > MESSAGE_TEXT_MAX) {
            await ctx.reply(
                `${e('warning')} متن خیلی بلند است (حداکثر ${MESSAGE_TEXT_MAX} کاراکتر).`,
                htmlOpts()
            );
            return true;
        }

        const payload = messageEntityOpts(text, sourceEntities);
        const sourceHtml = /<tg-emoji\b/i.test(text) ? text : undefined;

        touchSession(adminId, {
            step: 'destination',
            photoFileId: null,
            text: payload.text,
            entities: payload.entities,
            sourceHtml
        });

        await ctx.reply(`${e('success')} متن ثبت شد.\nمقصد دکمه مینی‌اپ را انتخاب کن:`, {
            ...htmlOpts(),
            reply_markup: buildDestinationKeyboard()
        });
        return true;
    }

    if (session.step === 'anime_id') {
        const animeId = text.replace(/\s+/g, '');
        if (!/^[0-9a-f-]{8,}$/i.test(animeId) && !/^[a-z0-9-]{2,80}$/i.test(animeId)) {
            await ctx.reply(
                `${e('warning')} شناسه/اسلاگ انیمه معتبر بفرست (مثلاً UUID کاتالوگ).`,
                htmlOpts()
            );
            return true;
        }

        const dest = findDestination(session.destinationKey);
        const startapp =
            dest?.animeTab === 'episodes'
                ? `anime_${animeId}_episodes`
                : `anime_${animeId}`;

        touchSession(adminId, {
            step: 'button_label',
            startapp
        });

        const defaultLabel = dest?.defaultButton || 'مشاهده در مینی‌اپ';
        await ctx.reply(
            `${e('success')} مقصد: <code>${escapeHtml(startapp)}</code>\n\n` +
                `متن دکمه را بفرست، یا دکمهٔ پیش‌فرض را بزن.`,
            {
                ...htmlOpts(),
                reply_markup: buildLabelKeyboard(defaultLabel)
            }
        );
        return true;
    }

    if (session.step === 'button_label') {
        if (text.length > 64) {
            await ctx.reply(`${e('warning')} متن دکمه حداکثر ۶۴ کاراکتر است.`, htmlOpts());
            return true;
        }
        touchSession(adminId, {
            step: 'confirm',
            buttonText: text
        });
        await sendConfirmPreview(ctx, adminId);
        return true;
    }

    return false;
}

/**
 * @param {import('telegraf').Context} ctx
 */
async function handleCustomPostDestination(ctx) {
    if (!isAdminUserId(ctx.from?.id)) {
        await ctx.answerCbQuery('فقط ادمین.', { show_alert: true });
        return;
    }

    const adminId = String(ctx.from.id);
    const session = getSession(adminId);
    const key = String(ctx.match?.[1] ?? '');
    const dest = findDestination(key);

    if (!session || session.step !== 'destination' || !dest) {
        await ctx.answerCbQuery('جلسه منقضی — /custom_post را دوباره بزن.', {
            show_alert: true
        });
        return;
    }

    await ctx.answerCbQuery(dest.label);

    if (dest.needsAnimeId) {
        touchSession(adminId, {
            step: 'anime_id',
            destinationKey: dest.key,
            startapp: undefined
        });
        await ctx.reply(
            `${e('search')} شناسه یا اسلاگ انیمه کاتالوگ را بفرست:`,
            htmlOpts()
        );
        return;
    }

    touchSession(adminId, {
        step: 'button_label',
        destinationKey: dest.key,
        startapp: dest.startapp
    });

    await ctx.reply(
        `${e('success')} مقصد: <b>${escapeHtml(dest.label)}</b>\n` +
            `لینک: <code>${escapeHtml(buildMiniAppStartUrl(dest.startapp))}</code>\n\n` +
            `متن دکمه را بفرست، یا دکمهٔ پیش‌فرض را بزن.`,
        {
            ...htmlOpts(),
            reply_markup: buildLabelKeyboard(dest.defaultButton)
        }
    );
}

/**
 * @param {import('telegraf').Context} ctx
 */
async function handleCustomPostLabelDefault(ctx) {
    if (!isAdminUserId(ctx.from?.id)) {
        await ctx.answerCbQuery('فقط ادمین.', { show_alert: true });
        return;
    }

    const adminId = String(ctx.from.id);
    const session = getSession(adminId);
    if (!session || session.step !== 'button_label') {
        await ctx.answerCbQuery('جلسه منقضی — /custom_post را دوباره بزن.', {
            show_alert: true
        });
        return;
    }

    const dest = findDestination(session.destinationKey);
    const label = dest?.defaultButton || 'ورود به مینی‌اپ';
    await ctx.answerCbQuery(label);

    touchSession(adminId, {
        step: 'confirm',
        buttonText: label
    });
    await sendConfirmPreview(ctx, adminId);
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {string} adminId
 */
async function sendConfirmPreview(ctx, adminId) {
    const session = getSession(adminId);
    if (!session) return;

    const premiumCount = countCustomEmoji(session.entities);
    const ctaUrl = buildMiniAppStartUrl(session.startapp);
    const header =
        `${e('clipboard')} <b>پیش‌نمایش پست کانال</b>\n` +
        `دکمه: <b>${escapeHtml(session.buttonText || '')}</b>\n` +
        `لینک: <code>${escapeHtml(ctaUrl)}</code>` +
        (premiumCount > 0
            ? `\n${e('cool')} ${premiumCount} اموجی پرمیوم در پیش‌نمایش.`
            : '');

    await ctx.reply(header, htmlOpts());

    if (premiumCount > 0) {
        await ctx.reply(CHANNEL_PREMIUM_EMOJI_NOTE, htmlOpts());
    }

    const markup = buildConfirmKeyboard(session);
    let bodyMsg;

    if (session.photoFileId) {
        const captionHtml =
            session.sourceHtml && isBalancedTgEmojiHtml(session.sourceHtml)
                ? session.sourceHtml
                : session.text
                  ? messageToHtml(session.text, session.entities)
                  : '';
        bodyMsg = await sendPhotoWithHtmlCaption(
            ctx.telegram,
            ctx.chat.id,
            session.photoFileId,
            captionHtml || session.text || '',
            { reply_markup: markup }
        );
    } else {
        const useHtml =
            session.sourceHtml && isBalancedTgEmojiHtml(session.sourceHtml);
        if (useHtml) {
            bodyMsg = await ctx.telegram.sendMessage(
                ctx.chat.id,
                session.sourceHtml.slice(0, MESSAGE_TEXT_MAX),
                { parse_mode: 'HTML', reply_markup: markup }
            );
        } else {
            bodyMsg = await ctx.telegram.sendMessage(
                ctx.chat.id,
                session.text,
                session.entities?.length
                    ? { entities: session.entities, reply_markup: markup }
                    : { reply_markup: markup }
            );
        }
    }

    touchSession(adminId, {
        previewChatId: String(ctx.chat.id),
        previewMessageId: bodyMsg?.message_id
    });
}

/**
 * @param {import('telegraf').Telegram} telegram
 * @param {CustomChannelPostSession} session
 * @param {string} channelId
 * @param {import('telegraf/types').Message | undefined} previewMsg
 */
async function publishCustomPost(telegram, session, channelId, previewMsg) {
    const markup = buildMiniAppCtaKeyboard({
        text: session.buttonText,
        startapp: session.startapp
    });
    const extra = {
        reply_markup: markup,
        attachMarkupAfterSend: true,
        allowStripPremium: false
    };

    if (session.photoFileId) {
        let html =
            session.sourceHtml && isBalancedTgEmojiHtml(session.sourceHtml)
                ? session.sourceHtml
                : null;
        if (!html && session.text) {
            html = messageToHtml(
                previewMsg?.caption ?? session.text,
                previewMsg?.caption_entities ?? session.entities
            );
        }
        return sendPhotoWithHtmlCaption(
            telegram,
            channelId,
            session.photoFileId,
            html || session.text || '',
            extra
        );
    }

    const text = previewMsg?.text ?? session.text;
    const entities = previewMsg?.entities ?? session.entities;
    const customCount = countCustomEmoji(entities);

    let html =
        session.sourceHtml && isBalancedTgEmojiHtml(session.sourceHtml)
            ? session.sourceHtml
            : null;

    if (!html && customCount > 0 && text) {
        html = messageToHtml(text, entities);
    }

    if (html && countCustomEmoji(htmlToCaptionPayload(html).caption_entities) > 0) {
        return sendMessageWithHtml(telegram, channelId, html, extra);
    }

    if (!text) throw new Error('preview text missing');
    return sendMessageWithEntities(telegram, channelId, text, entities, extra);
}

/**
 * @param {import('telegraf').Context} ctx
 */
async function handleCustomPostPublish(ctx) {
    if (!isAdminUserId(ctx.from?.id)) {
        await ctx.answerCbQuery('فقط ادمین.', { show_alert: true });
        return;
    }

    const adminId = String(ctx.from.id);
    const session = getSession(adminId);
    const index = Number(ctx.match?.[1]);
    const channels = getPublishTargets();
    const target = channels[index];

    if (
        !session ||
        session.step !== 'confirm' ||
        (!session.photoFileId && !session.text) ||
        !target
    ) {
        await ctx.answerCbQuery('جلسه منقضی — /custom_post را دوباره بزن.', {
            show_alert: true
        });
        return;
    }

    await ctx.answerCbQuery(`ارسال به ${target.label}...`);

    try {
        try {
            await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        } catch {
            /* ignore */
        }

        const previewMsg = ctx.callbackQuery?.message;
        const sent = await publishCustomPost(
            ctx.telegram,
            session,
            target.id,
            previewMsg
        );

        clearSession(adminId);

        await ctx.reply(
            `${e('success')} پست در <b>${escapeHtml(target.label)}</b> منتشر شد.\n` +
                `message_id: <code>${escapeHtml(String(sent.message_id))}</code>\n` +
                `دکمه: ${escapeHtml(session.buttonText || '')}`,
            htmlOpts()
        );
    } catch (error) {
        console.error('custom_post publish error:', error);
        await ctx.reply(
            `${e('error')} خطا در ارسال: ${escapeHtml(error.message)}\n\n` +
                `${e('info')} bot باید در کانال ادمین باشد (Post messages).`,
            htmlOpts()
        );
    }
}

/**
 * @param {import('telegraf').Context} ctx
 */
async function handleCustomPostCancel(ctx) {
    if (!isAdminUserId(ctx.from?.id)) {
        await ctx.answerCbQuery('فقط ادمین.', { show_alert: true });
        return;
    }

    clearSession(String(ctx.from.id));
    await ctx.answerCbQuery('لغو شد');
    try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch {
        /* ignore */
    }
    await ctx.reply(`${e('stop')} پست کاستوم لغو شد.`, htmlOpts());
}

module.exports = {
    handleCustomPostCommand,
    handleCustomPostPhoto,
    handleCustomPostText,
    handleCustomPostDestination,
    handleCustomPostLabelDefault,
    handleCustomPostPublish,
    handleCustomPostCancel,
    hasActiveSession,
    clearSession
};
