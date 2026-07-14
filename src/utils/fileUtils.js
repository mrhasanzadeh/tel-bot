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

/**
 * @param {string | null | undefined} fileName
 * @returns {string}
 */
function getFileExtension(fileName) {
    const match = String(fileName ?? '').match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
}

/**
 * Broad media category used to block accidental cross-type DB overwrites.
 * @param {string | null | undefined} fileName
 * @returns {'subtitle' | 'video' | 'audio' | 'image' | 'unknown'}
 */
function getMediaKind(fileName) {
    const ext = getFileExtension(fileName);
    if (['zip', 'rar', '7z', 'ass', 'srt', 'ssa', 'sub'].includes(ext)) return 'subtitle';
    if (['mkv', 'mp4', 'avi', 'mov', 'webm', 'm4v'].includes(ext)) return 'video';
    if (['mp3', 'flac', 'aac', 'ogg', 'opus', 'm4a'].includes(ext)) return 'audio';
    if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image';
    return ext ? 'unknown' : 'unknown';
}

module.exports = {
    formatFileSize,
    generateFileKey,
    delay,
    delayCancellable,
    extractFileKeyFromCaption,
    getFileExtension,
    getMediaKind
}; 