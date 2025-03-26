require('dotenv').config();
const { Telegraf } = require('telegraf');
const handleFile = require('./handlers/fileHandler');
const handleStart = require('./handlers/startHandler');
const logService = require('./services/logService');

// Disable SSL verification for development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const bot = new Telegraf(process.env.BOT_TOKEN);

// Log all channel posts
bot.on('channel_post', async (ctx) => {
    try {+
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

// Start bot
bot.launch()
    .then(() => {
        console.log('✅ Bot started successfully!');
        console.log(`🤖 Bot Username: @${bot.botInfo?.username}`);
    })
    .catch((error) => {
        console.error('❌ Error starting bot:', error);
    }); 