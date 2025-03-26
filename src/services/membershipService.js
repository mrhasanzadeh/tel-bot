const config = require('../../config');

/**
 * Service for handling user membership functions
 * @class MembershipService
 */
class MembershipService {
    /**
     * Check if a user is a member of the required channel
     * @param {Object} ctx - Telegram context
     * @returns {Promise<boolean>} Whether user is a member
     */
    async checkUserMembership(ctx) {
        try {
            const member = await ctx.telegram.getChatMember(config.PUBLIC_CHANNEL_ID, ctx.from.id);
            return ['member', 'administrator', 'creator'].includes(member.status);
        } catch (error) {
            console.error('Error checking membership:', error);
            if (ctx.callbackQuery) {
                await ctx.answerCbQuery('⚠️ Error checking membership', { show_alert: true, cache_time: 0 });
            }
            return false;
        }
    }
}

module.exports = new MembershipService(); 