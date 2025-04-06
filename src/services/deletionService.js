const databaseService = require('./databaseService');
const bot = require('../bot');

class DeletionService {
    constructor() {
        this.checkInterval = 10000; // Check every 10 seconds
        this.startChecking();
    }

    async startChecking() {
        setInterval(async () => {
            try {
                await this.checkPendingDeletions();
            } catch (error) {
                console.error('Error checking pending deletions:', error);
            }
        }, this.checkInterval);
    }

    async checkPendingDeletions() {
        const now = new Date();
        const pendingDeletions = await databaseService.getPendingDeletions(now);

        for (const deletion of pendingDeletions) {
            try {
                // Delete each message
                for (const messageId of deletion.messageIds) {
                    await bot.telegram.deleteMessage(deletion.chatId, messageId);
                }

                // Remove from pending deletions
                await databaseService.removePendingDeletion(deletion._id);
            } catch (error) {
                console.error('Error deleting messages:', error);
                // If message is already deleted or not found, remove from pending
                if (error.description === 'Bad Request: message to delete not found') {
                    await databaseService.removePendingDeletion(deletion._id);
                }
            }
        }
    }
}

// Export singleton instance
module.exports = new DeletionService(); 