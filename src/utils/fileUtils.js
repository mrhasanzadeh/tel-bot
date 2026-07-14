/**
 * Formats file size in human-readable format
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted file size
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Generates a random file key
 * @returns {string} Generated key
 */
function generateFileKey() {
    const key = Math.floor(100000000 + Math.random() * 900000000).toString();
    console.log(`Generated Key: ${key}`);
    return key;
}

/**
 * Creates a Promise that resolves after a specified time
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>} Promise that resolves after the delay
 */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Delay that can be interrupted when cancelToken.cancelled becomes true
 * @param {number} ms
 * @param {{ cancelled?: boolean } | null | undefined} [cancelToken]
 * @returns {Promise<void>}
 */
async function delayCancellable(ms, cancelToken) {
    const step = 200;
    let remaining = ms;
    while (remaining > 0) {
        if (cancelToken?.cancelled) return;
        const chunk = Math.min(step, remaining);
        await delay(chunk);
        remaining -= chunk;
    }
}

/**
 * Extract bot file key from channel caption (Key: … or ?start=get_…).
 * @param {string | null | undefined} caption
 * @returns {string | null}
 */
function extractFileKeyFromCaption(caption) {
    const text = String(caption ?? '').trim();
    if (!text) return null;

    const keyLine = text.match(/(?:🔑\s*)?Key:\s*(\d+)/i);
    if (keyLine?.[1]) return keyLine[1].trim();

    const startMatch = text.match(/[?&]start=get_(\d+)/i);
    if (startMatch?.[1]) return startMatch[1].trim();

    const tokenMatch = text.match(/get_(\d+)/i);
    if (tokenMatch?.[1]) return tokenMatch[1].trim();

    return null;
}

module.exports = {
    formatFileSize,
    generateFileKey,
    delay,
    delayCancellable,
    extractFileKeyFromCaption
}; 