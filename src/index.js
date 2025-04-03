/**
 * Main module exports for the Telegram bot
 */

require('dotenv').config();
const { Telegraf } = require('telegraf');
const handleFile = require('./handlers/fileHandler');
const handleStart = require('./handlers/startHandler');
const logService = require('./services/logService');
const databaseService = require('./services/databaseService');
const fileHandlerService = require('./services/fileHandlerService');
const membershipService = require('./services/membershipService');
const { setupHandlers } = require('./handlers/botHandlers');
const fileUtils = require('./utils/fileUtils');
const uiUtils = require('./utils/uiUtils');

// Disable SSL verification for development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const bot = new Telegraf(process.env.BOT_TOKEN);

// Connect to database
databaseService.connect().catch(error => {
    console.error('❌ Failed to connect to database:', error);
    process.exit(1);
});

// Log all channel posts
bot.on('channel_post', async (ctx) => {
    try {
        const chatId = ctx.chat.id;
        const channelId = process.env.PRIVATE_CHANNEL_ID;
        
        if (chatId.toString() === channelId) {
            console.log('\n📨 New Channel Post:');
            console.log('----------------------------------------');
            console.log(`Channel ID: ${chatId}`);
            console.log(`Message ID: ${ctx.channelPost.message_id}`);
            console.log(`Date: ${new Date().toLocaleString('en-US')}`);
            
            if (ctx.channelPost.document) {
                const file = ctx.channelPost.document;
                console.log('\n📎 File Information:');
                console.log(`Name: ${file.file_name}`);
                console.log(`Size: ${(file.file_size / 1024 / 1024).toFixed(2)} MB`);
                console.log(`Type: ${file.mime_type}`);
            }
            
            console.log('----------------------------------------\n');
        }
    } catch (error) {
        console.error('Error logging channel post:', error.message);
    }
});

// Handle start command
bot.command('start', handleStart);

// Handle file messages in channel
bot.on('channel_post', handleFile);

// Setup all bot handlers
setupHandlers(bot);

module.exports = {
    bot,
    services: {
        databaseService,
        fileHandlerService,
        membershipService
    },
    handlers: {
        setupHandlers
    },
    utils: {
        fileUtils,
        uiUtils
    }
}; 