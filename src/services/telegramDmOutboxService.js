/**
 * Deliver queued Telegram DMs from api.shiori.cloud outbox.
 * API host (often Iran) cannot reach api.telegram.org; tel-bot can.
 */

const config = require('../../config');
const shioriApi = require('./shioriApiClient');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getMiniAppBotToken() {
    const dedicated = String(config.TELEGRAM_MINI_APP_BOT_TOKEN ?? '').trim();
    if (dedicated) return dedicated;
    return String(config.BOT_TOKEN ?? process.env.BOT_TOKEN ?? '').trim();
}

/**
 * @param {string} token
 * @param {string} method
 * @param {Record<string, unknown>} body
 */
async function callTelegram(token, method, body) {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return /** @type {{ ok: boolean, description?: string }} */ (await res.json());
}

/**
 * @param {{ chat_id: number, text: string, web_app_url?: string | null }} item
 */
async function sendOneDm(item) {
    const token = getMiniAppBotToken();
    if (!token) {
        return { ok: false, error: 'TELEGRAM_MINI_APP_BOT_TOKEN / BOT_TOKEN missing' };
    }

    const webAppUrl = item.web_app_url?.trim() || null;
    /** @type {Record<string, unknown>} */
    const payload = {
        chat_id: item.chat_id,
        text: item.text,
        disable_web_page_preview: true,
    };
    if (webAppUrl) {
        payload.reply_markup = {
            inline_keyboard: [
                [{ text: 'مشاهده در شیوری', web_app: { url: webAppUrl } }],
            ],
        };
    }

    let json = await callTelegram(token, 'sendMessage', payload);
    if (json.ok) return { ok: true };

    const desc = String(json.description ?? 'sendMessage failed');
    if (webAppUrl && /BUTTON|web_app|URL_INVALID/i.test(desc)) {
        const retry = await callTelegram(token, 'sendMessage', {
            chat_id: item.chat_id,
            text: item.text,
            disable_web_page_preview: true,
        });
        if (retry.ok) {
            console.warn(
                `📬 Telegram DM sent without web_app button (chat ${item.chat_id}): ${desc}`
            );
            return { ok: true };
        }
        return { ok: false, error: retry.description ?? desc };
    }

    return { ok: false, error: desc };
}

/**
 * @param {number} [limit]
 */
async function deliverPendingTelegramDms(limit = 40) {
    const token = getMiniAppBotToken();
    if (!token) {
        console.warn(
            '📬 Telegram DM poller: TELEGRAM_MINI_APP_BOT_TOKEN (or BOT_TOKEN) missing — skip'
        );
        return;
    }

    let data;
    try {
        data = await shioriApi.get(`/bot/telegram-dm/pending?limit=${limit}`);
    } catch (error) {
        console.warn('📬 telegram-dm pending poll failed:', error.message);
        return;
    }

    if (data == null) {
        console.warn(
            '📬 telegram-dm/pending returned 404 — deploy latest api.shiori.cloud'
        );
        return;
    }

    const items = Array.isArray(data?.items) ? data.items : [];
    if (!items.length) return;

    console.log(`📬 Telegram DM poller: delivering ${items.length} message(s)`);

    /** @type {Array<{ id: string, ok: boolean, error?: string }>} */
    const results = [];

    for (const item of items) {
        const id = String(item?.id ?? '').trim();
        const chatId = Number(item?.chat_id);
        if (!id || !Number.isFinite(chatId)) {
            if (id) results.push({ id, ok: false, error: 'invalid payload' });
            continue;
        }

        try {
            const sent = await sendOneDm({
                chat_id: chatId,
                text: String(item.text ?? ''),
                web_app_url: item.web_app_url ?? null,
            });
            results.push(
                sent.ok
                    ? { id, ok: true }
                    : { id, ok: false, error: sent.error ?? 'send failed' }
            );
            if (!sent.ok) {
                console.warn(`📬 DM failed chat=${chatId}: ${sent.error}`);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            results.push({ id, ok: false, error: message });
            console.warn(`📬 DM exception chat=${chatId}: ${message}`);
        }

        await sleep(55);
    }

    if (!results.length) return;

    try {
        await shioriApi.post('/bot/telegram-dm/ack', { results });
    } catch (error) {
        console.error('📬 telegram-dm ack failed:', error.message);
    }
}

/**
 * @param {number} [intervalMs]
 */
function startTelegramDmPoller(intervalMs = 4_000) {
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try {
            await deliverPendingTelegramDms();
        } finally {
            running = false;
        }
    };
    void tick();
    const timer = setInterval(() => {
        void tick();
    }, intervalMs);
    const tokenHint = getMiniAppBotToken()
        ? String(config.TELEGRAM_MINI_APP_BOT_TOKEN ?? '').trim() &&
          String(config.TELEGRAM_MINI_APP_BOT_TOKEN) !== String(config.BOT_TOKEN ?? '')
            ? 'TELEGRAM_MINI_APP_BOT_TOKEN'
            : 'BOT_TOKEN'
        : 'NO TOKEN';
    console.log(`📬 Telegram DM poller started (${intervalMs}ms) via ${tokenHint}`);
    return timer;
}

module.exports = {
    deliverPendingTelegramDms,
    startTelegramDmPoller,
};
