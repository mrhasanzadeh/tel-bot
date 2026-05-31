/**
 * Telegram premium (custom) emoji for bot messages and inline buttons.
 *
 * Set CUSTOM_EMOJI_<KEY> in .env with the document id from your emoji pack.
 * Requires: bot owner has Telegram Premium, or bot has a Fragment upgraded username.
 *
 * To find an id: send the custom emoji to @RawDataBot, or copy a message containing it
 * and inspect message.entities (type custom_emoji, field custom_emoji_id).
 */

const FALLBACK = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    timer: '⏱️',
    bot: '🤖',
    search: '🔍',
    megaphone: '📢',
    users: '👥',
    stop: '⛔️',
    info: 'ℹ️',
    package: '📦'
};

const ENV_KEYS = Object.keys(FALLBACK);

function loadIds() {
    const ids = {};
    for (const key of ENV_KEYS) {
        const envName = `CUSTOM_EMOJI_${key.toUpperCase()}`;
        ids[key] = (process.env[envName] || '').trim();
    }
    return ids;
}

const IDS = loadIds();

function isEnabled() {
    return ENV_KEYS.some((key) => Boolean(IDS[key]));
}

/**
 * @param {keyof typeof FALLBACK} name
 * @returns {string}
 */
function e(name) {
    const fallback = FALLBACK[name] ?? '';
    const id = IDS[name];
    if (!id) return fallback;
    return `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`;
}

/**
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * @param {Record<string, unknown>} [extra]
 * @returns {Record<string, unknown>}
 */
function messageOpts(extra = {}) {
    if (!isEnabled()) return { ...extra };
    return { parse_mode: 'HTML', ...extra };
}

/**
 * @param {{ text: string, emojiKey?: keyof typeof FALLBACK, url?: string, callback_data?: string }} opts
 * @returns {import('telegraf/types').InlineKeyboardButton}
 */
function inlineButton({ text, emojiKey, url, callback_data }) {
    const btn = { text };

    if (url) btn.url = url;
    if (callback_data) btn.callback_data = callback_data;

    const id = emojiKey ? IDS[emojiKey] : '';
    if (id) {
        btn.icon_custom_emoji_id = id;
    } else if (emojiKey && FALLBACK[emojiKey]) {
        btn.text = `${FALLBACK[emojiKey]} ${text}`.trim();
    }

    return btn;
}

module.exports = {
    e,
    escapeHtml,
    messageOpts,
    isEnabled,
    inlineButton,
    FALLBACK
};
