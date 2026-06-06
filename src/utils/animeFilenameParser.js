/**
 * Parse Shiori archive filenames into anime title + episode number.
 *
 * Video:  [Shiori] Chitose-kun wa Ramune Bin no Naka - 14 [1080p HEVC].mkv
 * Sub:    Chitose-kun wa Ramune Bin no Naka - 14 [Shiori].zip
 */

/**
 * @param {string} fileName
 * @returns {{ kind: 'video' | 'subtitle', title: string, episode: number } | null}
 */
function parseAnimeFilename(fileName) {
    const name = String(fileName ?? '').trim();
    if (!name) return null;

    const videoMatch = name.match(/\[Shiori\]\s*(.+?)\s*-\s*(\d{1,3})\s*\[1080p/i);
    if (videoMatch) {
        return {
            kind: 'video',
            title: videoMatch[1].trim(),
            episode: Number(videoMatch[2])
        };
    }

    const subMatch = name.match(/^(.+?)\s*-\s*(\d{1,3})\s*\[Shiori\]/i);
    if (subMatch) {
        return {
            kind: 'subtitle',
            title: subMatch[1].trim(),
            episode: Number(subMatch[2])
        };
    }

    return null;
}

/**
 * @param {string} title
 * @returns {string}
 */
function normalizeFilenameTitle(title) {
    return String(title ?? '').trim().toLowerCase();
}

module.exports = {
    parseAnimeFilename,
    normalizeFilenameTitle
};
