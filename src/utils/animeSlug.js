/**
 * @param {string} romaji
 * @returns {string}
 */
function slugFromRomaji(romaji) {
    return String(romaji ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

module.exports = { slugFromRomaji };
