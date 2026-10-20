const path = require('path');
const { parseAnimeFilename } = require('../utils/animeFilenameParser');
const { getSubtitleChannelId, normalizeChatId } = require('../utils/channelIds');
const shioriApi = require('./shioriApiClient');
const { getAdminUserIds } = require('../utils/channelIds');
const config = require('../../config');

const SUB_EXT = /\.(zip|ass)$/i;

/** Persian labels aligned with dash AdminAutomation JOB_STATE_FA */
const JOB_STATE_FA = {
    SUBTITLE_RECEIVED: 'ساب دریافت شد',
    MATCHED: 'مچ شد',
    ELIGIBLE: 'آماده اجرا',
    SEARCHING: 'جستجوی ریلیز',
    AWAITING_SELECTION: 'انتخاب ریلیز',
    DOWNLOAD_QUEUED: 'صف دانلود',
    DOWNLOADING: 'در حال دانلود',
    DOWNLOADED: 'دانلود شد',
    WAITING_FOR_SUBTITLE: 'منتظر ساب',
    ENCODING: 'انکود',
    MUXING: 'مکس ساب',
    VALIDATING: 'اعتبارسنجی',
    READY_FOR_ARCHIVE: 'آماده آرشیو',
    AWAITING_MANUAL_ARCHIVE: 'آرشیو دستی',
    ARCHIVING: 'آپلود آرشیو',
    LINKED: 'لینک شد',
    DRAFT_QUEUED: 'صف پیش‌نویس',
    AWAITING_APPROVAL: 'منتظر تأیید',
    PUBLISHED: 'منتشر شد',
    NEEDS_REVIEW: 'نیاز به بررسی',
    FAILED: 'ناموفق',
    CANCELLED: 'لغو شده',
};

const STAGE_HINT = {
    ELIGIBLE: 'ورکر به‌زودی جستجوی Nyaa را شروع می‌کند',
    NEEDS_REVIEW: 'نیاز به اقدام ادمین در داشبورد',
    WAITING_FOR_SUBTITLE: 'ساب به جاب قبلی وصل شد — مکس از سر گرفته می‌شود',
    AWAITING_SELECTION: 'ریلیز مبهم است — مگنت را در داشبورد انتخاب کن',
};

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

        if (result?.duplicate) {
            return true;
        }

        if (result?.job) {
            await notifyAdmins(ctx, formatJobStatusCard(result.job, fileName, result));
        } else if (result?.needs_review || result?.ineligible || result?.awaits_admin) {
            await notifyAdmins(
                ctx,
                `اتوماسیون ساب: <b>${escapeHtml(fileName)}</b>\n` +
                    `نتیجه: <code>${escapeHtml(
                        result.reason || 'needs_attention'
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

/**
 * Dashboard-like status card for automation jobs (HTML).
 * @param {Record<string, unknown>} job
 * @param {string} [fileName]
 * @param {Record<string, unknown>} [result]
 */
function formatJobStatusCard(job, fileName, result = {}) {
    const state = String(job.state || '');
    const stateFa = JOB_STATE_FA[state] || state;
    const title =
        job.anime_title ||
        job.anime_slug ||
        result?.submission?.filename_title ||
        '—';
    const ep = job.episode_number != null ? String(job.episode_number) : '—';
    const trigger = job.trigger_source || 'subtitle';
    const hint =
        STAGE_HINT[state] ||
        (result?.awaits_admin
            ? 'حالت manual — تا تأیید ادمین شروع نمی‌شود'
            : result?.reattached
              ? 'ساب به جاب در حال اجرا وصل شد'
              : '');
    const dashBase = String(
        config.SHIORI_DASH_URL || process.env.SHIORI_DASH_URL || 'https://dash.shiori.cloud'
    ).replace(/\/$/, '');
    const dashUrl = `${dashBase}/admin/automation/jobs/${job.id}`;

    const lines = [
        `🎬 <b>اتوماسیون سافت‌ساب</b>`,
        `<b>${escapeHtml(title)}</b> — قسمت <code>${escapeHtml(ep)}</code>`,
        `وضعیت: <b>${escapeHtml(stateFa)}</b> <code>${escapeHtml(state)}</code>`,
        `منبع: <code>${escapeHtml(trigger)}</code>`,
    ];
    if (fileName) {
        lines.push(`فایل: <code>${escapeHtml(fileName)}</code>`);
    }
    if (job.error_message) {
        lines.push(`خطا: <code>${escapeHtml(job.error_message)}</code>`);
    }
    if (hint) {
        lines.push(escapeHtml(hint));
    }
    lines.push(`<a href="${escapeHtml(dashUrl)}">باز کردن در داشبورد</a>`);
    return lines.join('\n');
}

async function notifyAdmins(ctx, html) {
    const ids = getAdminUserIds();
    for (const id of ids) {
        try {
            await ctx.telegram.sendMessage(id, html, {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
            });
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
    formatJobStatusCard,
};
