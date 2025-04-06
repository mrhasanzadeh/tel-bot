const { Telegraf } = require('telegraf');
const databaseService = require('../src/services/databaseService');
const config = require('../config');

// Initialize bot
const bot = new Telegraf(process.env.BOT_TOKEN);

module.exports = async (req, res) => {
    try {
        // Get all pending deletions
        const pendingDeletions = await databaseService.MessageDeletion.find({
            deleteAt: { $lte: new Date() }
        });

        // Process each deletion
        for (const deletion of pendingDeletions) {
            try {
                // Delete messages
                for (const messageId of deletion.messageIds) {
                    try {
                        await bot.telegram.deleteMessage(deletion.chatId, messageId);
                    } catch (error) {
                        console.error(`Error deleting message ${messageId}:`, error);
                    }
                }
                // Remove from database
                await databaseService.removeMessageDeletion(deletion._id);
            } catch (error) {
                console.error('Error processing deletion:', error);
            }
        }

        res.status(200).json({
            ok: true,
            processed: pendingDeletions.length
        });
    } catch (error) {
        console.error('Error in check-deletions:', error);
        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
}; 