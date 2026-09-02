const config = require('../../config');
const { e, htmlOpts, escapeHtml } = require('../utils/premiumEmoji');
const {
    countCustomEmoji,
    messageEntityOpts,
    sendMessageWithEntities
} = require('../utils/captionEntities');
const { buildMiniAppHomeKeyboard } = require('../utils/miniAppLinks');
const {
    getPublishChannelChoices,
    isAdminUserId,
    normalizeChatId
} = require('../utils/channelIds');
const { isChannelForwardMessage } = require('./channelDraftService');

const SESSION_TTL_MS = 15 * 60 * 1000;

/** @typedef {{
 *   step: 'target' | 'text' | 'confirm',
 *   channelId: string,
 *   replyToMessageId: number,
 *   text?: string,
 *   entities?: object[],
 *   expiresAt: number
 * }} ChannelPostSession */

/** @type {Map<string, ChannelPostSession>} */
const sessions = new Map();

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

function getChannelPostTargets() {
    /** @type {Array<{ id: string, label: string }>} */
    const choices = [...getPublishChannelChoices()];
    const testId = normalizeChatId(config.SCHEDULE_TEST_CHANNEL_ID);
    if (testId && !choices.some((row) => row.id === testId)) {
        choices.unshift({ id: testId, label: 'کانال تست' });
    }
    return choices;
}

/**
 * @param {import('telegraf/types').Message | undefined} message
 * @returns {{ channelId: string, replyToMessageId: number } | null}
 */
function extractChannelReplyTarget(message) {
    if (!message || !isChannelForwardMessage(message)) return null;

    const origin = message.forward_origin;
    const channelId =
        message.forward_from_chat?.id != null
            ? String(message.forward_from_chat.id)
            : origin?.type === 'channel' && origin.chat?.id != null
              ? String(origin.chat.id)
              : null;

    const rawMessageId =
        message.forward_from_message_id != null
            ? message.forward_from_message_id
            : origin?.type === 'channel' && origin.message_id != null
              ? origin.message_id
              : null;

    const replyToMessageId = Number(rawMessageId);
    if (!channelId || !Number.isFinite(replyToMessageId) || replyToMessageId <= 0) {
        return null;
    }

    return { channelId, replyToMessageId };
}

function buildPreviewKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '✅ ارسال ریپلای + دکمه مینی‌اپ', callback_data: 'cpost_send' }],
            [{ text: '❌ لغو', callback_data: 'cpost_cancel' }]
        ]
    };
}

/**
 * @param {import('telegraf').Context} ctx
 */
async function handleChannelPostCommand(ctx) {
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
        await ctx.reply(`${e('stop')} ارسال کانال لغو شد.`, htmlOpts());
        return;
    }

    if (parts.length >= 3) {
        const channelId = normalizeChatId(parts[1]);
        const replyToMessageId = Number(parts[2]);
        if (!channelId || !Number.isFinite(replyToMessageId) || replyToMessageId <= 0) {
            await ctx.reply(
                `${e('warning')} فرمت:\n` +
                    `<code>/channel_post</code>\n` +
                    `یا <code>/channel_post -1001234567890 42</code>`,
                htmlOpts()
            );
            return;
        }

        touchSession(adminId, {
            step: 'text',
            channelId,
            replyToMessageId
        });

        await ctx.reply(
            `${e('success')} هدف ست شد.\n` +
                `کانال: <code>${escapeHtml(channelId)}</code>\n` +
                `reply_to: <code>${escapeHtml(String(replyToMessageId))}</code>\n\n` +
                `حالا متن ریپلای را بفرست.`,
            htmlOpts()
        );
        return;
    }

    touchSession(adminId, {
        step: 'target',
        channelId: '',
        replyToMessageId: 0,
        text: undefined
    });

    await ctx.reply(
        `${e('megaphone')} <b>ارسال ریپلای کانال + دکمه مینی‌اپ</b>\n\n` +
            `۱) پست کانال (مثلاً همان عکس) را اینجا <b>فوروارد</b> کن\n` +
            `۲) متن رونمایی را بفرست (اموجی پرمیوم از کیبورد تلگرام یا HTML <tg-emoji>)\n` +
            `۳) کانال مقصد را از دکمه‌ها انتخاب کن\n\n` +
            `یا مستقیم:\n` +
            `<code>/channel_post CHAT_ID MESSAGE_ID</code>\n` +
            `لغو: <code>/channel_post cancel</code>`,
        htmlOpts()
    );
}

/**
 * @param {import('telegraf').Context} ctx
 * @returns {Promise<boolean>}
 */
async function handleChannelPostForward(ctx) {
    if (ctx.chat?.type !== 'private') return false;
    if (!isAdminUserId(ctx.from?.id)) return false;

    const adminId = String(ctx.from.id);
    const session = getSession(adminId);
    if (!session || session.step !== 'target') return false;

    const target = extractChannelReplyTarget(ctx.message);
    if (!target) {
        await ctx.reply(
            `${e('warning')} پست را مستقیم از <b>کانال</b> فوروارد کن (نه از چت خصوصی).`,
            htmlOpts()
        );
        return true;
    }

    touchSession(adminId, {
        step: 'text',
        channelId: target.channelId,
        replyToMessageId: target.replyToMessageId
    });

    await ctx.reply(
        `${e('success')} پست هدف ثبت شد.\n` +
            `کانال: <code>${escapeHtml(target.channelId)}</code>\n` +
            `message_id: <code>${escapeHtml(String(target.replyToMessageId))}</code>\n\n` +
            `حالا متن ریپلای را بفرست.`,
        htmlOpts()
    );
    return true;
}

/**
 * @param {import('telegraf').Context} ctx
 * @returns {Promise<boolean>}
 */
async function handleChannelPostText(ctx) {
    if (ctx.chat?.type !== 'private') return false;
    if (!isAdminUserId(ctx.from?.id)) return false;

    const adminId = String(ctx.from.id);
    const session = getSession(adminId);
    if (!session || session.step !== 'text') return false;

    const text = String(ctx.message?.text ?? ctx.message?.caption ?? '').trim();
    const sourceEntities = ctx.message?.entities ?? ctx.message?.caption_entities ?? [];
    if (!text) {
        await ctx.reply(`${e('warning')} متن خالی است.`, htmlOpts());
        return true;
    }

    const payload = messageEntityOpts(text, sourceEntities);
    if (payload.text.length > 4096) {
        await ctx.reply(`${e('warning')} متن خیلی بلند است (حداکثر ۴۰۹۶ کاراکتر).`, htmlOpts());
        return true;
    }

    touchSession(adminId, {
        step: 'confirm',
        text: payload.text,
        entities: payload.entities
    });

    const fresh = getSession(adminId);
    const channelLabel =
        getChannelPostTargets().find((row) => row.id === fresh.channelId)?.label ||
        fresh.channelId;
    const premiumCount = countCustomEmoji(fresh.entities);

    const previewHeader =
        `${e('clipboard')} <b>پیش‌نمایش ریپلای</b>\n` +
        `کانال: <b>${escapeHtml(channelLabel)}</b>\n` +
        `reply_to: <code>${escapeHtml(String(fresh.replyToMessageId))}</code>` +
        (premiumCount > 0
            ? `\n${e('cool')} ${premiumCount} اموجی پرمیوم حفظ می‌شود.`
            : '') +
        '\n\n';

    const previewOpts = {
        reply_markup: buildPreviewKeyboard()
    };

    if (fresh.entities?.length) {
        await ctx.reply(previewHeader.replace(/\n\n$/, ''), htmlOpts());
        await ctx.telegram.sendMessage(ctx.chat.id, fresh.text, {
            entities: fresh.entities,
            ...previewOpts
        });
    } else {
        await ctx.reply(`${previewHeader}${escapeHtml(fresh.text)}`, {
            ...htmlOpts(),
            ...previewOpts
        });
    }
    return true;
}

/**
 * @param {import('telegraf').Context} ctx
 */
async function handleChannelPostPublish(ctx) {
    if (!isAdminUserId(ctx.from?.id)) {
        await ctx.answerCbQuery('فقط ادمین.', { show_alert: true });
        return;
    }

    const adminId = String(ctx.from.id);
    const session = getSession(adminId);
    if (!session || session.step !== 'confirm' || !session.text || !session.channelId) {
        await ctx.answerCbQuery('جلسه منقضی شده — /channel_post را دوباره بزن.', {
            show_alert: true
        });
        return;
    }

    await ctx.answerCbQuery('در حال ارسال...');

    try {
        try {
            await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        } catch {
            /* ignore */
        }

        const sent = await sendMessageWithEntities(
            ctx.telegram,
            session.channelId,
            session.text,
            session.entities,
            {
                reply_to_message_id: session.replyToMessageId,
                reply_markup: buildMiniAppHomeKeyboard(),
                attachMarkupAfterSend: true,
                allowStripPremium: false
            }
        );

        const publishedCustomEmoji = countCustomEmoji(sent?.entities);
        const expectedCustomEmoji = countCustomEmoji(session.entities);

        clearSession(adminId);

        const label =
            getChannelPostTargets().find((row) => row.id === session.channelId)?.label ||
            session.channelId;
        await ctx.reply(
            `${e('success')} ریپلای ارسال شد در <b>${escapeHtml(label)}</b>.\n` +
                `message_id: <code>${escapeHtml(String(sent.message_id))}</code>` +
                (expectedCustomEmoji > 0 && publishedCustomEmoji < expectedCustomEmoji
                    ? `\n${e('warning')} اموجی پرمیوم در کانال ${publishedCustomEmoji}/${expectedCustomEmoji} — لاگ سرور را چک کن.`
                    : ''),
            htmlOpts()
        );
    } catch (error) {
        console.error('channel_post publish error:', error);
        await ctx.reply(
            `${e('error')} خطا در ارسال: ${escapeHtml(error.message)}\n\n` +
                `${e('info')} tel-bot باید در همان کانال ادمین باشد (Post messages). ` +
                `اگر ریپلای دستی زدی، اول آن را حذف کن.`,
            htmlOpts()
        );
    }
}

/**
 * @param {import('telegraf').Context} ctx
 */
async function handleChannelPostCancel(ctx) {
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
    await ctx.reply(`${e('stop')} ارسال کانال لغو شد.`, htmlOpts());
}

module.exports = {
    handleChannelPostCommand,
    handleChannelPostForward,
    handleChannelPostText,
    handleChannelPostPublish,
    handleChannelPostCancel
};
