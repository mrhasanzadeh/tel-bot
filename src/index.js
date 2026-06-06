/**
 * Main module exports for the Telegram bot
 */

require('dotenv').config();
const { Telegraf } = require('telegraf');
const databaseService = require('./services/databaseService');
const membershipService = require('./services/membershipService');
const { setupHandlers } = require('./handlers/botHandlers');
const { logChannelSetup } = require('./services/channelSetup');
const scheduleService = require('./services/scheduleService');

// Disable SSL verification for development
if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_INSECURE_TLS === '1') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

// Validate required environment variables
const requiredEnvVars = [
    'BOT_TOKEN',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'PRIVATE_CHANNEL_ID',
    'PUBLIC_CHANNEL_ID',
    'PUBLIC_CHANNEL_USERNAME',
    'ADDITIONAL_CHANNEL_ID',
    'ADDITIONAL_CHANNEL_USERNAME'
];

const missingEnvVars = requiredEnvVars.filter((varName) => !process.env[varName]);
if (missingEnvVars.length > 0) {
    console.error(`❌ Missing required environment variables: ${missingEnvVars.join(', ')}`);
    throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

if (!process.env.LINKS_CHANNEL_ID?.trim()) {
    console.warn(
        '⚠️ LINKS_CHANNEL_ID is not set — archive uploads will not be copied to PRIVATE_CHANNEL_ID'
    );
}

const bot = new Telegraf(process.env.BOT_TOKEN);

membershipService.setTelegram(bot);
scheduleService.setTelegram(bot);

if (!process.env.ADMIN_USER_ID?.trim()) {
    console.warn('⚠️ ADMIN_USER_ID is not set — schedule approval flow is disabled');
}

bot.catch((err, ctx) => {
    console.error(`Error handling update ${ctx.update.update_id}:`, err);
});

async function start() {
    await databaseService.connect();

    setupHandlers(bot);

    await bot.launch({
        allowedUpdates: [
            'message',
            'channel_post',
            'edited_channel_post',
            'edited_message',
            'callback_query',
            'message_delete'
        ]
    });

    console.log('✅ Bot started successfully');
    await logChannelSetup(bot);
}

start().catch((err) => {
    console.error('❌ Failed to start bot:', err);
    process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = {
    bot
};
