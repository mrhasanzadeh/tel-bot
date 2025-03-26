const { Telegraf } = require('telegraf');
const https = require('https');
const config = require('../config');
const databaseService = require('../src/services/databaseService');
const fileHandlerService = require('../src/services/fileHandlerService');
const { setupHandlers } = require('../src/handlers/botHandlers');
const { markMessageDeleted } = require('../src/utils/fileUtils');

// Initialize the bot with the token from config
const bot = new Telegraf(config.BOT_TOKEN, {
    telegram: {
        apiRoot: 'https://api.telegram.org',
        agent: new https.Agent({
            rejectUnauthorized: false
        })
    }
});

// Connect to database
databaseService.connect().catch(error => {
    console.error('❌ Failed to connect to database:', error);
});

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
    console.error(`Error handling update ${ctx.update.update_id}:`, err);
});

// Export the bot instance
module.exports = bot; 