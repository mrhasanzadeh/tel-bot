require('dotenv').config();

const parseEnvBool = (value, defaultValue = true) => {
    if (value === undefined || value === null || String(value).trim() === '') {
        return defaultValue;
    }
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return defaultValue;
};

module.exports = {
    parseEnvBool,
    BOT_TOKEN: process.env.BOT_TOKEN,
    DATABASE_URL: process.env.DATABASE_URL,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    PRIVATE_CHANNEL_ID: process.env.PRIVATE_CHANNEL_ID,
    LINKS_CHANNEL_ID: process.env.LINKS_CHANNEL_ID,
    ARCHIVE_CHANNEL_ID: process.env.ARCHIVE_CHANNEL_ID || process.env.LINKS_CHANNEL_ID,
    /** Default archive → private copy on boot (overridable via /mirroring + bot_settings) */
    ARCHIVE_MIRROR_ENABLED: parseEnvBool(process.env.ARCHIVE_MIRROR_ENABLED, true),
    PUBLIC_CHANNEL_ID: process.env.PUBLIC_CHANNEL_ID,
    PUBLIC_CHANNEL_USERNAME: process.env.PUBLIC_CHANNEL_USERNAME,
    ADDITIONAL_CHANNEL_ID: process.env.ADDITIONAL_CHANNEL_ID,
    ADDITIONAL_CHANNEL_USERNAME: process.env.ADDITIONAL_CHANNEL_USERNAME,
    PUBLIC_POSTS_CHANNEL_ID:
        process.env.PUBLIC_POSTS_CHANNEL_ID || process.env.ADDITIONAL_CHANNEL_ID,
    /** When set, schedule posts publish here instead of PUBLIC_POSTS_CHANNEL_ID */
    SCHEDULE_TEST_CHANNEL_ID: process.env.SCHEDULE_TEST_CHANNEL_ID || null,
    ADMIN_USER_ID: process.env.ADMIN_USER_ID,
    PACK_FILE_DELETE_MS: Number(process.env.PACK_FILE_DELETE_MS) || 120000,
    SCHEDULE_DEFAULT_STAFF: process.env.SCHEDULE_DEFAULT_STAFF || 'Dawn',
    SCHEDULE_DEFAULT_HASHTAG: process.env.SCHEDULE_DEFAULT_HASHTAG || null,
    SCHEDULE_DEFAULT_DONATION_URL: process.env.SCHEDULE_DEFAULT_DONATION_URL || null,
    SCHEDULE_DEFAULT_SYNOPSIS_URL: process.env.SCHEDULE_DEFAULT_SYNOPSIS_URL || null
};
