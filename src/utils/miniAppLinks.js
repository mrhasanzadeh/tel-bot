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
 * Deep link that opens mini-app anime detail on the episodes tab.
 * @param {string} catalogAnimeId
 */
function buildAnimeEpisodesMiniAppUrl(catalogAnimeId) {
    const id = String(catalogAnimeId ?? '').trim();
    if (!id) return '';
    const bot = getMiniAppBotUsername();
    return `https://t.me/${bot}?startapp=${encodeURIComponent(`anime_${id}_episodes`)}`;
}

/** Opens mini-app home (launch / generic channel CTA). */
function buildMiniAppHomeUrl() {
    const bot = getMiniAppBotUsername();
    return `https://t.me/${bot}?startapp`;
}

/**
 * Glass-style url button for generic mini-app entry.
 * @param {string} [buttonText]
 * @returns {{ inline_keyboard: import('telegraf/types').InlineKeyboardButton[][] }}
 */
function buildMiniAppHomeKeyboard(buttonText = 'ورود به مینی‌اپ') {
    return {
        inline_keyboard: [
            [
                inlineButton({
                    text: buttonText,
                    url: buildMiniAppHomeUrl()
                })
            ]
        ]
    };
}

/**
 * Glass-style url button under channel posts.
 * @param {string | null | undefined} catalogAnimeId
 * @returns {{ inline_keyboard: import('telegraf/types').InlineKeyboardButton[][] } | null}
 */
function buildMiniAppDownloadKeyboard(catalogAnimeId) {
    const url = buildAnimeEpisodesMiniAppUrl(catalogAnimeId);
    if (!url) return null;
    return {
        inline_keyboard: [
            [
                inlineButton({
                    text: 'دانلود از مینی‌اپ',
                    url
                })
            ]
        ]
    };
}

module.exports = {
    setCachedBotUsername,
    getBotUsername,
    getMiniAppBotUsername,
    buildAnimeEpisodesMiniAppUrl,
    buildMiniAppHomeUrl,
    buildMiniAppHomeKeyboard,
    buildMiniAppDownloadKeyboard
};
