const { Telegraf } = require('telegraf');
const https = require('https');
const config = require('../config');
const fileHandlerService = require('../src/services/fileHandlerService');
const { setupHandlers } = require('../src/handlers/botHandlers');
const { markMessageDeleted } = require('../src/utils/fileUtils');
const membershipService = require('../src/services/membershipService');

// Validate required environment variables
const requiredEnvVars = ['BOT_TOKEN', 'MONGODB_URI', 'PRIVATE_CHANNEL_ID', 'PUBLIC_CHANNEL_ID', 'PUBLIC_CHANNEL_USERNAME'];
const missingEnvVars = requiredEnvVars.filter(varName => !config[varName]);

if (missingEnvVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingEnvVars);
    throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

// Create HTTPS agent with SSL verification disabled
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true,
    timeout: 60000
});

// Initialize the bot with the token from config
const bot = new Telegraf(config.BOT_TOKEN, {
    telegram: {
        apiRoot: 'https://api.telegram.org',
        agent: httpsAgent
    }
});

// Initialize bot
const initializeBot = async () => {
    try {
        console.log('🚀 Initializing bot...');
        console.log('📝 Bot configuration:', {
            privateChannelId: config.PRIVATE_CHANNEL_ID,
            publicChannelId: config.PUBLIC_CHANNEL_ID,
            publicChannelUsername: config.PUBLIC_CHANNEL_USERNAME
        });
        
        // Set up membership service
        membershipService.setTelegram(bot.telegram);
        console.log('✅ Membership service initialized');
        
        // Store previously seen message IDs
        const channelMessages = new Map();

        // Track channel messages
        bot.on('channel_post', (ctx, next) => {
            const chatId = ctx.chat.id;
            const messageId = ctx.channelPost.message_id;
            
            if (chatId && messageId && chatId.toString() === config.PRIVATE_CHANNEL_ID.toString()) {
                if (!channelMessages.has(chatId)) {
                    channelMessages.set(chatId, new Set());
                }
                channelMessages.get(chatId).add(messageId);
                console.log(`📝 Tracking new channel message: ${messageId}`);
            }
            
            return next();
        });

        // Listen for message deletions in channels
        bot.on('message_delete', async (ctx) => {
            try {
                const chatId = ctx.chat.id;
                
                if (chatId && chatId.toString() === config.PRIVATE_CHANNEL_ID.toString()) {
                    const messageIds = ctx.update?.message_delete?.message_ids || [];
                    
                    if (messageIds.length > 0) {
                        console.log(`\n🗑️ Message deletion detected directly: ${messageIds.join(', ')}`);
                        
                        // Remove from tracking
                        messageIds.forEach(id => {
                            markMessageDeleted(channelMessages, chatId, id);
                        });
                        
                        // Process deletion in database
                        await fileHandlerService.handleDeletedMessages({ chat: { id: chatId } }, messageIds);
                    }
                }
            } catch (error) {
                console.error('Error handling direct message deletion:', error);
            }
        });

        // Setup all bot handlers
        setupHandlers(bot);

        // Handle errors
        bot.catch((err, ctx) => {
            console.error(`❌ Error handling update ${ctx.update.update_id}:`, {
                error: err,
                update: ctx.update,
                type: err.name,
                code: err.code
            });
        });

        console.log('✅ Bot initialized successfully');
    } catch (error) {
        console.error('❌ Failed to initialize bot:', error);
        throw error;
    }
};

// Initialize the bot
initializeBot().catch(error => {
    console.error('❌ Fatal error during bot initialization:', error);
    process.exit(1);
});

// Export the bot instance
module.exports = bot; 