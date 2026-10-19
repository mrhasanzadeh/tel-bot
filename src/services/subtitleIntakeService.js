const path = require('path');
const { parseAnimeFilename } = require('../utils/animeFilenameParser');
const { getSubtitleChannelId, normalizeChatId } = require('../utils/channelIds');
const shioriApi = require('./shioriApiClient');
const { getAdminUserIds } = require('../utils/channelIds');

const SUB_EXT = /\.(zip|ass)$/i;

/**
 * Handle translator subtitle uploads on SUBTITLE_CHANNEL_ID.
 * @param {import('telegraf').Context} ctx
 * @returns {Promise<boolean>} true if this chat was the subtitle channel (handled or ignored)
 */
async function routeSubtitleChannel(ctx) {
    const subtitleId = getSubtitleChannelId();
    if (!subtitleId) return false;

    const post = ctx.channelPost || ctx.message;
    const chatId = normalizeChatId(ctx.chat?.id);
    if (!post || chatId !== subtitleId) return false;

    console.log(
        `📥 Subtitle channel hit chat=${chatId} msg=${post.message_id} ` +
            `hasDocument=${Boolean(post.document)}`
    );

    const doc = post.document;
    if (!doc) {
        console.log(`⏭️ Subtitle channel non-document ignored msg=${post.message_id}`);
        return true;
    }

    const fileName = String(doc.file_name || '').trim();
    if (!SUB_EXT.test(fileName)) {
        console.log(`⏭️ Subtitle channel unsupported file: ${fileName || '(no name)'}`);
        return true;
    }

    const parsed = parseAnimeFilename(fileName);
    if (!parsed || parsed.kind !== 'subtitle') {
        console.warn(`⚠️ Subtitle filename unparsed: ${fileName}`);
        await notifyAdmins(
            ctx,
            `ساب با نام نامعتبر در کانال مترجم:\n<code>${escapeHtml(fileName)}</code>`
        );
        // still record as ambiguous via API with episode null
    }

    try {
        const result = await shioriApi.post('/bot/automation/subtitle-submissions', {
            telegram_chat_id: chatId,
            telegram_message_id: post.message_id,
            telegram_file_id: doc.file_id,
            original_file_name: fileName,
            filename_title: parsed?.title ?? null,
            episode_number: parsed?.episode ?? null,
            extracted_meta: {
                file_size: doc.file_size ?? null,
                mime_type: doc.mime_type ?? null,
                extension: path.extname(fileName).toLowerCase(),
            },
        });

        console.log(
            `📝 Subtitle intake: ${fileName} → ` +
                `dup=${Boolean(result?.duplicate)} ` +
                `job=${result?.job?.id || 'none'} ` +
                `state=${result?.job?.state || result?.reason || result?.status || 'ok'}`
        );

        if (result?.needs_review || result?.ineligible || result?.awaits_admin) {
            await notifyAdmins(
                ctx,
                `اتوماسیون ساب: <b>${escapeHtml(fileName)}</b>\n` +
                    `نتیجه: <code>${escapeHtml(
                        result.reason || result.job?.state || 'needs_attention'
                    )}</code>`
            );
        }
    } catch (err) {
        console.error('❌ Subtitle intake API error:', err);
        await notifyAdmins(
            ctx,
            `خطا در ثبت ساب اتوماسیون:\n<code>${escapeHtml(fileName)}</code>\n${escapeHtml(
                err instanceof Error ? err.message : String(err)
            )}`
        );
    }

    return true;
}

async function notifyAdmins(ctx, html) {
    const ids = getAdminUserIds();
    for (const id of ids) {
        try {
            await ctx.telegram.sendMessage(id, html, { parse_mode: 'HTML' });
        } catch (err) {
            console.error(`subtitle intake notify admin ${id}:`, err.message || err);
        }
    }
}

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

module.exports = {
    routeSubtitleChannel,
};
