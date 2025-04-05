const { Telegraf } = require('telegraf');
const { HttpsProxyAgent } = require('https-proxy-agent');
const membershipService = require('../src/services/membershipService');
const { setupHandlers } = require('../src/handlers/botHandlers');
const databaseService = require('../src/services/databaseService');

// Validate required environment variables
const requiredEnvVars = [
    'BOT_TOKEN',
    'MONGODB_URI',
    'PRIVATE_CHANNEL_ID',
    'PUBLIC_CHANNEL_ID',
    'PUBLIC_CHANNEL_USERNAME'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
    console.error(`❌ Missing required environment variables: ${missingEnvVars.join(', ')}`);
    process.exit(1);
}

// Create HTTPS agent for proxy support if needed
const httpsAgent = process.env.HTTPS_PROXY ? new HttpsProxyAgent(process.env.HTTPS_PROXY) : null;

// Initialize bot with token
const bot = new Telegraf(process.env.BOT_TOKEN, {
    telegram: {
        agent: httpsAgent
    }
});

// Set up membership service with bot instance
membershipService.setTelegram(bot);

// Connect to MongoDB
databaseService.connect()
    .then(() => {
        console.log('✅ Connected to MongoDB');
    })
    .catch(error => {
        console.error('❌ MongoDB connection error:', error);
        process.exit(1);
    });

// Set up message tracking for private channel
const messageTracker = new Map();

// Handle message deletions in private channel
bot.on('message_delete', async (ctx) => {
    try {
        const chatId = ctx.chat.id;
        
        if (chatId && chatId.toString() === process.env.PRIVATE_CHANNEL_ID.toString()) {
            const messageIds = ctx.update?.message_delete?.message_ids || [];
            
            if (messageIds.length > 0) {
                console.log(`🗑️ Processing ${messageIds.length} deleted messages`);
                for (const messageId of messageIds) {
                    await databaseService.deactivateFilesByMessageId(messageId);
                }
                console.log('✅ Successfully processed deleted messages');
            }
        }
    } catch (error) {
        console.error('❌ Error handling message deletion:', error);
    }
});

// Set up bot handlers
setupHandlers(bot);

// Handle errors
bot.catch((error, ctx) => {
    console.error('❌ Bot error:', error);
    console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        code: error.code
    });
    
    if (ctx) {
        ctx.reply('متأسفانه خطایی رخ داد. لطفاً دوباره تلاش کنید.')
            .catch(replyError => {
                console.error('❌ Error sending error message:', replyError);
            });
    }
});

// Start the bot
bot.launch()
    .then(() => {
        console.log('✅ Bot started successfully');
        console.log(`👤 Bot username: @${bot.botInfo.username}`);
        console.log(`📢 Tracking messages in private channel: ${process.env.PRIVATE_CHANNEL_ID}`);
    })
    .catch(error => {
        console.error('❌ Error starting bot:', error);
        process.exit(1);
    });

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = bot; 