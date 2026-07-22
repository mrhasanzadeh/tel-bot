const shioriApi = require('./shioriApiClient');

const CACHE_TTL_MS = 45_000;

let cache = {
    campaigns: null,
    fetchedAt: 0
};

function getEnvFallbackCampaigns() {
    const campaigns = [];

    if (process.env.PUBLIC_CHANNEL_ID?.trim()) {
        campaigns.push({
            id: null,
            channel_id: process.env.PUBLIC_CHANNEL_ID.trim(),
            channel_username: process.env.PUBLIC_CHANNEL_USERNAME?.trim() || null,
            title: 'کانال اول',
            target_count: null,
            joined_count: null,
            sort_order: 0
        });
    }

    if (process.env.ADDITIONAL_CHANNEL_ID?.trim()) {
        campaigns.push({
            id: null,
            channel_id: process.env.ADDITIONAL_CHANNEL_ID.trim(),
            channel_username: process.env.ADDITIONAL_CHANNEL_USERNAME?.trim() || null,
            title: 'کانال دوم',
            target_count: null,
            joined_count: null,
            sort_order: 1
        });
    }

    return campaigns;
}

async function fetchActiveCampaigns() {
    const response = await shioriApi.get('/bot/sponsor-campaigns/active');
    if (!response || !Array.isArray(response.data)) {
        return [];
    }
    return response.data;
}

/**
 * Active sponsor campaigns from API, or env fallback when none are configured.
 * @returns {Promise<Array<{
 *   id: string|null,
 *   channel_id: string,
 *   channel_username: string|null,
 *   title: string,
 *   target_count: number|null,
 *   joined_count: number|null,
 *   sort_order: number
 * }>>}
 */
async function getRequiredChannels() {
    const now = Date.now();
    if (cache.campaigns && now - cache.fetchedAt < CACHE_TTL_MS) {
        return cache.campaigns;
    }

    try {
        const active = await fetchActiveCampaigns();
        if (active.length > 0) {
            cache = { campaigns: active, fetchedAt: now };
            return active;
        }
    } catch (error) {
        console.error('❌ Failed to fetch sponsor campaigns from API:', error.message);
    }

    const fallback = getEnvFallbackCampaigns();
    cache = { campaigns: fallback, fetchedAt: now };
    return fallback;
}

function invalidateCache() {
    cache = { campaigns: null, fetchedAt: 0 };
}

function isGateEnabled(channels) {
    return Array.isArray(channels) && channels.length > 0;
}

module.exports = {
    getRequiredChannels,
    getEnvFallbackCampaigns,
    invalidateCache,
    isGateEnabled
};
