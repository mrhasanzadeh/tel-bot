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
                return { isAllMember: false, memberships: {} };
            }

            if (!process.env.PUBLIC_CHANNEL_ID || !process.env.ADDITIONAL_CHANNEL_ID) {
                console.error('❌ Channel IDs environment variables are not set');
                return { isAllMember: false, memberships: {} };
            }

            console.log(`🔍 Checking membership for user ${userId}`);
            
            // Check first channel
            console.log(`📢 Checking membership in first channel ${process.env.PUBLIC_CHANNEL_ID}`);
            const chatMember1 = await this.telegram.telegram.getChatMember(
                process.env.PUBLIC_CHANNEL_ID,
                userId
            );
            const isMember1 = ['member', 'administrator', 'creator'].includes(chatMember1.status);
            console.log(`👤 User ${userId} first channel status: ${chatMember1.status} (isMember: ${isMember1})`);

            // Check second channel
            console.log(`📢 Checking membership in second channel ${process.env.ADDITIONAL_CHANNEL_ID}`);
            const chatMember2 = await this.telegram.telegram.getChatMember(
                process.env.ADDITIONAL_CHANNEL_ID,
                userId
            );
            const isMember2 = ['member', 'administrator', 'creator'].includes(chatMember2.status);
            console.log(`👤 User ${userId} second channel status: ${chatMember2.status} (isMember: ${isMember2})`);

            // User must be a member of both channels
            const isAllMember = isMember1 && isMember2;
            console.log(`👤 User ${userId} final membership status: ${isAllMember}`);

            return {
                isAllMember,
                memberships: {
                    [process.env.PUBLIC_CHANNEL_USERNAME]: {
                        name: 'کانال اول',
                        isMember: isMember1
                    },
                    [process.env.ADDITIONAL_CHANNEL_USERNAME]: {
                        name: 'کانال دوم',
                        isMember: isMember2
                    }
                }
            };
        } catch (error) {
            console.error('❌ Error checking membership:', error);
            if (error.response) {
                console.error('Telegram API Response:', error.response.data);
            }
            return { isAllMember: false, memberships: {} };
        }
    }
}

// Create and export a single instance of the service
const membershipService = new MembershipService();
module.exports = membershipService; 