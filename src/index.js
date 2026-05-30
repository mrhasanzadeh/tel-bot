/**
 * Main module exports for the Telegram bot
 */

require('dotenv').config();
const { Telegraf } = require('telegraf');
const databaseService = require('./services/databaseService');
const membershipService = require('./services/membershipService');
const { setupHandlers } = require('./handlers/botHandlers');

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

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
    console.error(`❌ Missing required environment variables: ${missingEnvVars.join(', ')}`);
    throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

// Set up membership service with bot instance
membershipService.setTelegram(bot);

// Connect to database
databaseService.connect().catch(error => {
    console.error('❌ Failed to connect to database:', error);
    process.exit(1);
});

// Setup all bot handlers
setupHandlers(bot);

// Handle errors
bot.catch((err, ctx) => {
    console.error(`Error handling update ${ctx.update.update_id}:`, err);
});

// Start the bot
bot.launch()
    .then(() => {
        console.log('✅ Bot started successfully');
    })
    .catch(err => {
        console.error('❌ Failed to start bot:', err);
        process.exit(1);
    });

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = {
    bot
};