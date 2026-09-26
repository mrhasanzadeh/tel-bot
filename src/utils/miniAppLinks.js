const config = require('../../config');
const { inlineButton } = require('./premiumEmoji');

let cachedBotUsername = null;

/**
 * @param {string | null | undefined} username
 */
function setCachedBotUsername(username) {
    const cleaned = String(username ?? '')
        .trim()
        .replace(/^@/, '');
    if (cleaned) cachedBotUsername = cleaned;
}

function getMiniAppBotUsername() {
    const fromEnv = String(config.TELEGRAM_MINI_APP_BOT_USERNAME ?? '')
        .trim()
        .replace(/^@/, '');
    if (fromEnv) return fromEnv;
    return 'ShioriMiniBot';
}

function getBotUsername() {
    const fromEnv = String(config.TELEGRAM_BOT_USERNAME ?? '')
        .trim()
        .replace(/^@/, '');
    if (fromEnv) return fromEnv;
    return cachedBotUsername || 'ShioriUploadBot';
}

/**
 * Channel-safe mini-app URL: t.me/MiniBot?startapp[=payload]
 * Empty / null payload → bare home launch.
 * @param {string | null | undefined} startappPayload
 */
function buildMiniAppStartUrl(startappPayload) {
    const bot = getMiniAppBotUsername();
    const payload = String(startappPayload ?? '').trim();
    if (!payload) return `https://t.me/${bot}?startapp`;
    return `https://t.me/${bot}?startapp=${encodeURIComponent(payload)}`;
}

/**
 * Deep link that opens mini-app anime detail on the episodes tab.
 * @param {string} catalogAnimeId
 */
function buildAnimeEpisodesMiniAppUrl(catalogAnimeId) {
    const id = String(catalogAnimeId ?? '').trim();
    if (!id) return '';
    return buildMiniAppStartUrl(`anime_${id}_episodes`);
}

/**
 * Deep link that opens mini-app anime info tab.
 * @param {string} catalogAnimeId
 */
function buildAnimeInfoMiniAppUrl(catalogAnimeId) {
    const id = String(catalogAnimeId ?? '').trim();
    if (!id) return '';
    return buildMiniAppStartUrl(`anime_${id}`);
}

/** Opens mini-app home (launch / generic channel CTA). */
function buildMiniAppHomeUrl() {
    return buildMiniAppStartUrl(null);
}

/**
 * URL keyboard for a custom channel CTA (glass style when clients support it).
 * @param {{ text?: string, startapp?: string | null }} [opts]
 * @returns {{ inline_keyboard: import('telegraf/types').InlineKeyboardButton[][] } | null}
 */
function buildMiniAppCtaKeyboard(opts = {}) {
    const text = String(opts.text ?? '').trim() || 'ورود به مینی‌اپ';
    const url = buildMiniAppStartUrl(opts.startapp);
    if (!url) return null;
    return {
        inline_keyboard: [
            [
                inlineButton({
                    text,
                    url
                })
            ]
        ]
    };
}

/**
 * Glass-style url button for generic mini-app entry.
 * @param {string} [buttonText]
 * @returns {{ inline_keyboard: import('telegraf/types').InlineKeyboardButton[][] }}
 */
function buildMiniAppHomeKeyboard(buttonText = 'ورود به مینی‌اپ') {
    return buildMiniAppCtaKeyboard({ text: buttonText, startapp: null });
}

/**
 * Glass-style url button under channel posts.
 * @param {string | null | undefined} catalogAnimeId
 * @returns {{ inline_keyboard: import('telegraf/types').InlineKeyboardButton[][] } | null}
 */
function buildMiniAppDownloadKeyboard(catalogAnimeId) {
    const url = buildAnimeEpisodesMiniAppUrl(catalogAnimeId);
    if (!url) return null;
    return buildMiniAppCtaKeyboard({
        text: 'دانلود از مینی‌اپ',
        startapp: `anime_${String(catalogAnimeId).trim()}_episodes`
    });
}

module.exports = {
    setCachedBotUsername,
    getBotUsername,
    getMiniAppBotUsername,
    buildMiniAppStartUrl,
    buildAnimeEpisodesMiniAppUrl,
    buildAnimeInfoMiniAppUrl,
    buildMiniAppHomeUrl,
    buildMiniAppCtaKeyboard,
    buildMiniAppHomeKeyboard,
    buildMiniAppDownloadKeyboard
};
