const config = require('../../config');

/**
 * Service for handling membership checks
 * @class MembershipService
 */
class MembershipService {
    /**
     * Create a new membership service instance
     */
    constructor() {
        if (MembershipService.instance) {
            return MembershipService.instance;
        }
        MembershipService.instance = this;
        this.telegram = null;
    }

    /**
     * Set the Telegram bot instance
     * @param {Object} bot - Telegraf bot instance
     */
    setTelegram(bot) {
        this.telegram = bot;
    }

    /**
     * Check if a user is a member of the required channel
     * @param {number} userId - Telegram user ID
     * @returns {Promise<boolean>} Whether the user is a member
     */
    async isMember(userId) {
        try {
            if (!this.telegram) {
                console.error('❌ Telegram bot instance not set in membership service');
                return false;
            }

            console.log(`🔍 Checking membership for user ${userId}`);
            
            // Get the chat member status
            const chatMember = await this.telegram.telegram.getChatMember(
                process.env.PUBLIC_CHANNEL_ID,
                userId
            );
            
            // Check if the user is a member, administrator, or creator
            const isMember = ['member', 'administrator', 'creator'].includes(chatMember.status);
            
            console.log(`👤 User ${userId} membership status: ${chatMember.status} (isMember: ${isMember})`);
            
            return isMember;
        } catch (error) {
            console.error('❌ Error checking membership:', error);
            return false;
        }
    }
}

// Create and export a single instance of the service
const membershipService = new MembershipService();
module.exports = membershipService; 