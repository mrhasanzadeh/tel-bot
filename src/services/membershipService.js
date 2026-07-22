const sponsorCampaignService = require('./sponsorCampaignService');

const MEMBER_STATUSES = new Set(['member', 'administrator', 'creator']);

/**
 * Service for handling membership checks against dynamic sponsor campaigns.
 */
class MembershipService {
    constructor() {
        if (MembershipService.instance) {
            return MembershipService.instance;
        }
        MembershipService.instance = this;
        this.telegram = null;
    }

    /**
     * @param {import('telegraf').Telegraf} bot
     */
    setTelegram(bot) {
        this.telegram = bot;
    }

    /**
     * @param {string|number} userId
     * @returns {Promise<{
     *   isAllMember: boolean,
     *   memberships: Record<string, {
     *     name: string,
     *     isMember: boolean,
     *     username: string|null,
     *     campaignId: string|null,
     *     channelId: string
     *   }>,
     *   channels: Array<Record<string, unknown>>
     * }>}
     */
    async isMember(userId) {
        try {
            if (!this.telegram) {
                console.error('❌ Telegram bot instance not set in membership service');
                return { isAllMember: true, memberships: {}, channels: [] };
            }

            const channels = await sponsorCampaignService.getRequiredChannels();
            if (!sponsorCampaignService.isGateEnabled(channels)) {
                return { isAllMember: true, memberships: {}, channels: [] };
            }

            console.log(`🔍 Checking membership for user ${userId} (${channels.length} channel(s))`);

            const memberships = {};
            let isAllMember = true;

            for (const channel of channels) {
                const channelId = String(channel.channel_id ?? '').trim();
                if (!channelId) continue;

                const key = channel.channel_username || channelId;
                console.log(`📢 Checking membership in channel ${channelId} (${channel.title})`);

                try {
                    const chatMember = await this.telegram.telegram.getChatMember(channelId, userId);
                    const isMember = MEMBER_STATUSES.has(chatMember.status);
                    console.log(
                        `👤 User ${userId} channel ${channelId} status: ${chatMember.status} (isMember: ${isMember})`
                    );

                    memberships[key] = {
                        name: channel.title || key,
                        isMember,
                        username: channel.channel_username || null,
                        campaignId: channel.id || null,
                        channelId
                    };

                    if (!isMember) {
                        isAllMember = false;
                    }
                } catch (error) {
                    console.error(`❌ Error checking channel ${channelId}:`, error.message);
                    memberships[key] = {
                        name: channel.title || key,
                        isMember: false,
                        username: channel.channel_username || null,
                        campaignId: channel.id || null,
                        channelId
                    };
                    isAllMember = false;
                }
            }

            console.log(`👤 User ${userId} final membership status: ${isAllMember}`);
            return { isAllMember, memberships, channels };
        } catch (error) {
            console.error('❌ Error checking membership:', error);
            if (error.response) {
                console.error('Telegram API Response:', error.response.data);
            }
            return { isAllMember: false, memberships: {}, channels: [] };
        }
    }
}

const membershipService = new MembershipService();
module.exports = membershipService;
