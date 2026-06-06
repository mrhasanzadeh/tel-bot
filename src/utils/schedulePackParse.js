/**
 * Parse admin-provided pack links/keys for schedule completion posts.
 */

/**
 * @param {string} input
 * @returns {string | null} pack slug stored in anime_posts.pack_episodes_slug
 */
function parsePackEpisodesSlug(input) {
    const text = String(input ?? '').trim();
    if (!text) return null;

    const linkMatch = text.match(/[?&]start=pack_([^\s&]+)/i);
    if (linkMatch?.[1]) {
        return `pack_${linkMatch[1]}`;
    }

    if (text.startsWith('pack_')) {
        return text;
    }

    return null;
}

/**
 * @param {string} input
 * @returns {string | null} file key for pack subtitle zip
 */
function parsePackSubtitleKey(input) {
    const text = String(input ?? '').trim();
    if (!text) return null;

    if (text.startsWith('get_')) {
        return text.slice('get_'.length).trim() || null;
    }

    const startMatch = text.match(/[?&]start=get_([^\s&]+)/i);
    if (startMatch?.[1]) {
        return startMatch[1].trim();
    }

    const tokenMatch = text.match(/get_([^\s]+)/i);
    if (tokenMatch?.[1]) {
        return tokenMatch[1].trim();
    }

    if (/^\d+$/.test(text)) {
        return text;
    }

    return null;
}

module.exports = {
    parsePackEpisodesSlug,
    parsePackSubtitleKey
};
