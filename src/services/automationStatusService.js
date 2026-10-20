/**
 * Live automation status card: one Telegram message per job, edited in place.
 *
 * Delivery is claimed atomically on the API so intake sync + the poller
 * cannot both send a fresh message for the same revision.
 */

const shioriApi = require('./shioriApiClient');
const { getAdminUserIds } = require('../utils/channelIds');

function uniqueAdminIds() {
    return [...new Set(getAdminUserIds().map((id) => String(id).trim()).filter(Boolean))];
}

/**
 * @param {import('telegraf').Telegram} telegram
 * @param {{
 *   job_id: string,
 *   rev: number,
 *   html: string,
 *   messages?: Record<string, number>,
 *   restore_delivered_rev?: number,
 * }} item
 */
async function deliverOneLiveStatus(telegram, item) {
    const jobId = String(item?.job_id ?? '').trim();
    const html = String(item?.html ?? '').trim();
    const rev = Number(item?.rev) || 0;
    if (!jobId || !html || rev < 1) return;

    const adminIds = uniqueAdminIds();
    if (!adminIds.length) {
        console.warn('🎬 live status: ADMIN_USER_ID missing');
        await releaseClaim(jobId, rev, item.restore_delivered_rev);
        return;
    }

    /** @type {Record<string, number>} */
    const messages = { ...(item.messages || {}) };
    let deliveredOk = false;

    try {
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
                        deliveredOk = true;
                    } catch (editErr) {
                        const desc = String(editErr?.description || editErr?.message || editErr);
                        if (/message is not modified/i.test(desc)) {
                            deliveredOk = true;
                        } else {
                            const sent = await telegram.sendMessage(adminId, html, {
                                parse_mode: 'HTML',
                                disable_web_page_preview: true,
                            });
                            if (sent?.message_id) {
                                messages[key] = sent.message_id;
                                deliveredOk = true;
                            }
                        }
                    }
                } else {
                    const sent = await telegram.sendMessage(adminId, html, {
                        parse_mode: 'HTML',
                        disable_web_page_preview: true,
                    });
                    if (sent?.message_id) {
                        messages[key] = sent.message_id;
                        deliveredOk = true;
                    }
                }
            } catch (err) {
                console.error(
                    `🎬 live status admin ${adminId} job=${jobId}:`,
                    err?.description || err?.message || err
                );
            }
        }

        if (!deliveredOk) {
            await releaseClaim(jobId, rev, item.restore_delivered_rev);
            return;
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
    } catch (err) {
        console.error(`🎬 live status deliver failed job=${jobId}:`, err?.message || err);
        await releaseClaim(jobId, rev, item.restore_delivered_rev);
    }
}

/**
 * @param {string} jobId
 * @param {number} rev
 * @param {number} [restoreDeliveredRev]
 */
async function releaseClaim(jobId, rev, restoreDeliveredRev) {
    try {
        await shioriApi.post(`/bot/automation/jobs/${encodeURIComponent(jobId)}/ack-status`, {
            rev,
            release: true,
            restore_delivered_rev: Number(restoreDeliveredRev) || 0,
        });
    } catch (err) {
        console.warn(
            `🎬 live status release failed job=${jobId}:`,
            err?.message || err
        );
    }
}

/**
 * @param {import('telegraf').Telegram} telegram
 * @param {{ limit?: number, jobId?: string }} [opts]
 */
async function claimAndDeliver(telegram, opts = {}) {
    let data;
    try {
        data = await shioriApi.post('/bot/automation/jobs/claim-status', {
            limit: opts.limit ?? 15,
            job_id: opts.jobId || undefined,
        });
    } catch (error) {
        try {
            const q = new URLSearchParams();
            q.set('limit', String(opts.limit ?? 15));
            if (opts.jobId) q.set('job_id', opts.jobId);
            data = await shioriApi.get(`/bot/automation/jobs/pending-status?${q}`);
        } catch (err2) {
            console.warn('🎬 claim-status failed:', error.message || error);
            return;
        }
    }
    if (data == null) return;

    const items = Array.isArray(data?.items) ? data.items : [];
    if (items.length && !opts.jobId) {
        console.log(`🎬 Live status poller: ${items.length} update(s)`);
    }
    for (const item of items) {
        await deliverOneLiveStatus(telegram, item);
    }
}

/**
 * @param {import('telegraf').Telegraf} bot
 */
async function deliverPendingAutomationStatus(bot) {
    await claimAndDeliver(bot.telegram, { limit: 15 });
}

/**
 * Immediately claim+sync one job after intake.
 * @param {import('telegraf').Telegram} telegram
 * @param {Record<string, unknown>} job
 */
async function syncJobLiveStatusFromDto(telegram, job) {
    const jobId = String(job?.id ?? '').trim();
    if (!jobId) return;
    const live = job?.progress?.tg_live;
    if (!live || typeof live !== 'object') return;
    const rev = Number(live.rev) || 0;
    if (rev < 1) return;

    await claimAndDeliver(telegram, { limit: 1, jobId });
}

module.exports = {
    deliverPendingAutomationStatus,
    deliverOneLiveStatus,
    syncJobLiveStatusFromDto,
};
