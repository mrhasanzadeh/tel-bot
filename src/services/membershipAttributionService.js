const shioriApi = require('./shioriApiClient');
const sponsorCampaignService = require('./sponsorCampaignService');

/**
 * Attribute verified joins to sponsor campaigns (skips env fallback channels).
 * @param {string} userId
 * @param {Record<string, { isMember: boolean, campaignId?: string|null }>} memberships
 */
async function attributeVerifiedJoins(userId, memberships) {
    const attributedCampaignIds = new Set();

    for (const status of Object.values(memberships)) {
        if (!status.isMember || !status.campaignId) continue;
        if (attributedCampaignIds.has(status.campaignId)) continue;

        attributedCampaignIds.add(status.campaignId);
        try {
            const result = await shioriApi.post(
                `/bot/sponsor-campaigns/${status.campaignId}/attribute-join`,
                { telegram_user_id: userId }
            );
            if (result?.data?.attributed) {
                console.log(
                    `✅ Attributed join for user ${userId} to campaign ${status.campaignId} ` +
                        `(joined_count=${result.data.joined_count}, active=${result.data.is_active})`
                );
                sponsorCampaignService.invalidateCache();
            }
        } catch (error) {
            console.error(
                `❌ Failed to attribute join for user ${userId} campaign ${status.campaignId}:`,
                error.message
            );
        }
    }
}

module.exports = {
    attributeVerifiedJoins
};
