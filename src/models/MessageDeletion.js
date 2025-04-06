const mongoose = require('mongoose');

const messageDeletionSchema = new mongoose.Schema({
    chatId: {
        type: Number,
        required: true,
        index: true
    },
    messageIds: [{
        type: Number,
        required: true
    }],
    deleteAt: {
        type: Date,
        required: true,
        index: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Create index for efficient querying
messageDeletionSchema.index({ deleteAt: 1, chatId: 1 });

module.exports = mongoose.model('MessageDeletion', messageDeletionSchema); 