const shioriApi = require('./shioriApiClient');
const { e, htmlOpts, escapeHtml } = require('../utils/premiumEmoji');
const { getAdminUserId } = require('../utils/channelIds');

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
 * /bind_channel_post <catalog_slug> — reply to a forwarded channel post.
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
    const animeRef = parts[1] || '';
    if (!animeRef) {
        await ctx.reply(
            `${e('clipboard')} <b>راهنما</b>\n` +
                `۱) آخرین پست کانال را به اینجا فوروارد کن\n` +
                `۲) روی همان پیام ریپلای بزن:\n` +
                `<code>/bind_channel_post &lt;slug-کاتالوگ&gt;</code>`,
            htmlOpts()
        );
        return;
    }

    const source = ctx.message?.reply_to_message;
    const payload = extractChannelPostPayload(source);
    if (!payload) {
        await ctx.reply(
            `${e('warning')} باید روی یک <b>پست فورواردشده از کانال</b> (با عکس و کپشن) ریپلای بزنی.`,
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

    // Strip @BotName if Telegram appended it to the command entity.
    const animeKey = String(animeRef).replace(/@[\w]+$/i, '').trim();

    try {
        const result = await shioriApi.put(
            `/bot/anime/${encodeURIComponent(animeKey)}/channel-template`,
            {
                cover_file_id: payload.coverFileId,
                caption_text: payload.captionText,
                caption_entities: payload.captionEntities,
                channel_id: channelId,
                channel_message_id: payload.channelMessageId
            }
        );

        await ctx.reply(
            `${e('success')} قالب کانال ذخیره شد.\n` +
                `<b>${escapeHtml(result?.title || animeKey)}</b>\n` +
                `slug: <code>${escapeHtml(result?.slug || animeKey)}</code>\n` +
                `از این به بعد با افزودن قسمت در پنل، پیش‌نویس برایت می‌آید.`,
            htmlOpts()
        );
    } catch (error) {
        console.error('bind_channel_post error:', error);
        await ctx.reply(
            `${e('error')} خطا در ذخیره قالب: ${escapeHtml(error.message)}`,
            htmlOpts()
        );
    }
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
        if (action === 'reject') {
            await shioriApi.post(`/bot/channel-drafts/${encodeURIComponent(draftId)}/reject`);
            await ctx.reply(`${e('stop')} پیش‌نویس رد شد.`, htmlOpts());
            return;
        }

        const published = await shioriApi.post(
            `/bot/channel-drafts/${encodeURIComponent(draftId)}/publish`
        );
        await ctx.reply(
            `${e('success')} منتشر شد.\n` +
                `message_id: <code>${escapeHtml(String(published?.published_message_id ?? ''))}</code>`,
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

module.exports = {
    handleBindChannelPost,
    handleChannelDraftCallback,
    extractChannelPostPayload
};
