/**
 * Parse and format translator/staff names for schedule captions.
 */

/**
 * @param {string} input
 * @returns {string[]}
 */
function parseStaffNames(input) {
    const text = String(input ?? '').trim();
    if (!text) return [];

    return text
        .split(/\s*(?:,|&| و )\s*/u)
        .map((part) => part.trim())
        .filter(Boolean);
}

/**
 * @param {string[]} names
 * @returns {string}
 */
function formatStaffNames(names) {
    const list = (names || []).map((n) => String(n).trim()).filter(Boolean);
    if (list.length === 0) return '';
    if (list.length === 1) return list[0];
    if (list.length === 2) return `${list[0]} & ${list[1]}`;
    return `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}`;
}

/**
 * @param {string} input
 * @returns {string | null} formatted staff or null if invalid
 */
function normalizeStaffInput(input) {
    const formatted = formatStaffNames(parseStaffNames(input));
    return formatted || null;
}

/**
 * @param {boolean} hasKaraoke
 * @returns {string} HTML-safe label (uses &amp; for &)
 */
function buildStaffCreditLabel(hasKaraoke) {
    return hasKaraoke
        ? 'Translation, TypeSetting &amp; Karaoke:'
        : 'Translation &amp; TypeSetting:';
}

module.exports = {
    parseStaffNames,
    formatStaffNames,
    normalizeStaffInput,
    buildStaffCreditLabel
};
