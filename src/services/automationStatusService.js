/**
 * Live automation status card: one Telegram message per job, edited in place.
 */

const shioriApi = require('./shioriApiClient');
const { getAdminUserIds } = require('../utils/channelIds');

/**
 * @param {import('telegraf').Telegram} telegram
 * @param {{
 *   job_id: string,
 *   rev: number,
 *   html: string,
 *   messages?: Record<string, number>,
 * }} item
 */
async function deliverOneLiveStatus(telegram, item) {
    const jobId = String(item?.job_id ?? '').trim();
    const html = String(item?.html ?? '').trim();
    const rev = Number(item?.rev) || 0;
    if (!jobId || !html || rev < 1) return;

    const adminIds = getAdminUserIds();
    if (!adminIds.length) {
        console.warn('🎬 live status: ADMIN_USER_ID missing');
        return;
    }

    /** @type {Record<string, number>} */
    const messages = { ...(item.messages || {}) };

    for (const adminId of adminIds) {
        const key = String(adminId);
        const existing = Number(messages[key]) || 0;
        try {
            if (existing > 0) {
                try {
                    await telegram.editMessageText(adminId, existing, undefined, html, {
                        parse_mode: 'HTML',
                        disable_web_page_preview: true,
                    });
                } catch (editErr) {
                    const desc = String(editErr?.description || editErr?.message || editErr);
                    if (/message is not modified/i.test(desc)) {
                        /* same text — fine */
                    } else {
                        // Message gone or uneditable — send a fresh one
                        const sent = await telegram.sendMessage(adminId, html, {
                            parse_mode: 'HTML',
                            disable_web_page_preview: true,
                        });
                        if (sent?.message_id) messages[key] = sent.message_id;
                    }
                }
            } else {
                const sent = await telegram.sendMessage(adminId, html, {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                });
                if (sent?.message_id) messages[key] = sent.message_id;
            }
        } catch (err) {
            console.error(
                `🎬 live status admin ${adminId} job=${jobId}:`,
                err?.description || err?.message || err
            );
        }
    }

    try {
        await shioriApi.post(`/bot/automation/jobs/${encodeURIComponent(jobId)}/ack-status`, {
            rev,
            messages,
        });
    } catch (err) {
        console.warn(
            `🎬 live status ack failed job=${jobId}:`,
            err?.message || err
        );
    }
}

/**
 * @param {import('telegraf').Telegraf} bot
 */
async function deliverPendingAutomationStatus(bot) {
    let data;
    try {
        data = await shioriApi.get('/bot/automation/jobs/pending-status?limit=15');
    } catch (error) {
        console.warn('🎬 pending-status poll failed:', error.message);
        return;
    }
    if (data == null) return;

    const items = Array.isArray(data?.items) ? data.items : [];
    if (!items.length) return;

    console.log(`🎬 Live status poller: ${items.length} update(s)`);
    for (const item of items) {
        await deliverOneLiveStatus(bot.telegram, item);
    }
}

/**
 * Immediately sync one job after intake (uses job.progress.tg_live from API).
 * @param {import('telegraf').Telegram} telegram
 * @param {Record<string, unknown>} job
 */
async function syncJobLiveStatusFromDto(telegram, job) {
    const live = job?.progress?.tg_live;
    if (!live || typeof live !== 'object') return;
    const html = String(live.html ?? '').trim();
    const rev = Number(live.rev) || 0;
    if (!html || !job?.id || rev < 1) return;

    await deliverOneLiveStatus(telegram, {
        job_id: String(job.id),
        rev,
        html,
        messages:
            live.messages && typeof live.messages === 'object'
                ? /** @type {Record<string, number>} */ (live.messages)
                : {},
    });
}

module.exports = {
    deliverPendingAutomationStatus,
    deliverOneLiveStatus,
    syncJobLiveStatusFromDto,
};
