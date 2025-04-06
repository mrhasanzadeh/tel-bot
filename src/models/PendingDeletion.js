const mongoose = require('mongoose');

const pendingDeletionSchema = new mongoose.Schema({
    chatId: {
        type: String,
        required: true
    },
    messageIds: {
        type: [Number],
        required: true
    },
    deletionTime: {
        type: Date,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Index for efficient querying of pending deletions
pendingDeletionSchema.index({ deletionTime: 1 });

module.exports = mongoose.model('PendingDeletion', pendingDeletionSchema); 