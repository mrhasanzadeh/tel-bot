const mongoose = require('mongoose');
const moment = require('moment');
const { formatFileSize } = require('../utils/fileUtils');

/**
 * Schema for file storage in database
 * @typedef {Object} FileSchema
 * @property {string} key - Unique identifier for the file
 * @property {number} messageId - Telegram message ID
 * @property {string} type - Type of file (document, photo, video, audio, text)
 * @property {string} fileId - Telegram file ID
 * @property {string} fileName - Name of the file
 * @property {number} fileSize - Size of file in bytes
 * @property {Date} date - Date when file was created
 * @property {number} downloads - Number of times file was downloaded
 * @property {Date} lastAccessed - Date when file was last accessed
 * @property {boolean} isActive - Whether file is active or deleted
 */
const fileSchema = new mongoose.Schema({
    key: {
        type: String,
        required: true,
        unique: true
    },
    messageId: {
        type: Number,
        required: true
    },
    type: {
        type: String,
        required: true,
        enum: ['document', 'photo', 'video', 'audio', 'text']
    },
    fileId: {
        type: String,
        required: true
    },
    fileName: {
        type: String,
        required: true
    },
    fileSize: {
        type: Number,
        required: true
    },
    date: {
        type: Date,
        default: Date.now
    },
    downloads: {
        type: Number,
        default: 0
    },
    lastAccessed: {
        type: Date
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Create necessary indexes
fileSchema.index({ key: 1 });
fileSchema.index({ date: 1 });
fileSchema.index({ isActive: 1 });

/**
 * Increment download count for the file
 * @returns {Promise<Document>} Updated file document
 */
fileSchema.methods.incrementDownloads = async function() {
    this.downloads += 1;
    this.lastAccessed = new Date();
    return this.save();
};

/**
 * Get formatted creation date
 * @returns {string} Formatted date string
 */
fileSchema.methods.getFormattedDate = function() {
    return moment(this.date).format('YYYY-MM-DD HH:mm:ss');
};

/**
 * Get human-readable file size
 * @returns {string} Formatted file size
 */
fileSchema.methods.getFormattedSize = function() {
    return formatFileSize(this.fileSize);
};

const File = mongoose.model('File', fileSchema);

module.exports = File; 