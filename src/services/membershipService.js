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
     * @param {Object} telegram - Telegram bot instance
     */
    setTelegram(telegram) {
        this.telegram = telegram;
    }

    /**
     * Check if a user is a member of the required channel
     * @param {number} userId - The user's Telegram ID
     * @returns {Promise<boolean>} Whether the user is a member
     */
    async isMember(userId) {
        try {
            if (!this.telegram) {
                console.error('❌ Telegram instance not set in membership service');
                return false;
            }

            const channelId = config.PUBLIC_CHANNEL_ID;
            console.log(`🔍 Checking membership for user ${userId} in channel ${channelId}`);

            try {
                const chatMember = await this.telegram.getChatMember(channelId, userId);
                const isMember = ['member', 'administrator', 'creator'].includes(chatMember.status);
                console.log(`✅ Membership check result for user ${userId}: ${isMember}`);
                return isMember;
            } catch (error) {
                if (error.response?.error_code === 400 && error.response?.description?.includes('chat not found')) {
                    console.error('❌ Bot cannot access the channel. Please ensure the bot is added to the channel.');
                    return false;
                }
                console.error('❌ Error checking membership:', error);
                return false;
            }
        } catch (error) {
            console.error('❌ Error in membership check:', error);
            return false;
        }
    }
}

// Create and export a single instance of the service
const membershipService = new MembershipService();
module.exports = membershipService; 