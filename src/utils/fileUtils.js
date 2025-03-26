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
 * Updates message tracking when a message is deleted
 * @param {Map} trackedMessages - Map of tracked messages
 * @param {string|number} chatId - Chat ID
 * @param {number} messageId - Message ID to remove
 * @returns {boolean} Whether the message was in the tracking list
 */
function markMessageDeleted(trackedMessages, chatId, messageId) {
    if (!trackedMessages.has(chatId)) {
        return false;
    }
    
    const messages = trackedMessages.get(chatId);
    const wasTracked = messages.has(messageId);
    
    if (wasTracked) {
        messages.delete(messageId);
        console.log(`Removed message ${messageId} from tracking`);
    }
    
    return wasTracked;
}

module.exports = {
    formatFileSize,
    generateFileKey,
    delay,
    markMessageDeleted
}; 