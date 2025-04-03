const membershipService = require('../services/membershipService');
const fileHandlerService = require('../services/fileHandlerService');
const { sendNotMemberMessage } = require('../utils/uiUtils');

// Store pending links for non-member users
const pendingLinks = new Map();

/**
 * Setup bot event handlers
 * @param {Object} bot - Telegraf bot instance
 * @returns {void}
 */
function setupHandlers(bot) {
    // Handle channel posts
    bot.on('channel_post', async (ctx) => {
        try {
            console.log('📨 Received channel post');
            const chatId = ctx.chat.id;
            const messageId = ctx.channelPost.message_id;
            
            if (chatId && messageId && chatId.toString() === process.env.PRIVATE_CHANNEL_ID.toString()) {
                console.log('✅ Processing file in private channel');
                await fileHandlerService.handleNewFile(ctx);
            }
        } catch (error) {
            console.error('❌ Error handling channel post:', error);
        }
    });

    // Handle deleted messages
    bot.on('message_delete', async (ctx) => {
        try {
            const chatId = ctx.chat.id;
            
            if (chatId && chatId.toString() === process.env.PRIVATE_CHANNEL_ID.toString()) {
                const messageIds = ctx.update?.message_delete?.message_ids || [];
                
                if (messageIds.length > 0) {
                    await fileHandlerService.handleDeletedMessages(ctx, messageIds);
                }
            }
        } catch (error) {
            console.error('❌ Error handling message deletion:', error);
        }
    });

    // Handle /start command
    bot.command('start', handleStartCommand);

    // Handle membership check callback
    bot.action(/check_membership_(.+)/, handleMembershipCheck);

    // Handle direct file requests
    bot.on('text', async (ctx) => {
        try {
            const text = ctx.message.text;
            if (text.startsWith('get_')) {
                const fileKey = text.replace('get_', '');
                console.log(`🔍 Processing file request for key: ${fileKey}`);
                await fileHandlerService.sendFileToUser(ctx, fileKey);
            }
        } catch (error) {
            console.error('❌ Error handling file request:', error);
            await ctx.reply('متأسفانه خطایی رخ داد. لطفاً دوباره تلاش کنید.');
        }
    });
}

/**
 * Handle /start command
 * @param {Object} ctx - Telegram context
 * @returns {Promise<void>}
 */
async function handleStartCommand(ctx) {
    try {
        console.log('🚀 Handling start command');
        const userId = ctx.from.id;
        const username = ctx.from.username;
        const startPayload = ctx.message.text.split(' ')[1];

        // Check if user is a member
        const isMember = await membershipService.isMember(userId);
        console.log(`👤 User ${userId} membership status: ${isMember}`);

        if (startPayload && startPayload.startsWith('get_')) {
            const fileKey = startPayload.replace('get_', '');
            console.log(`📥 Processing file request for key: ${fileKey}`);
            
            if (isMember) {
                await fileHandlerService.sendFileToUser(ctx, fileKey);
            } else {
                // Store the file request for later
                pendingLinks.set(userId, fileKey);
                console.log(`📝 Stored pending file request for user ${userId}`);
                
                // Show join button
                const joinButton = {
                    inline_keyboard: [[
                        { text: '👥 عضویت در کانال', url: `https://t.me/${process.env.PUBLIC_CHANNEL_USERNAME}` },
                        { text: '✅ بررسی عضویت', callback_data: `check_membership_${userId}` }
                    ]]
                };

                await ctx.reply(
                    'برای دریافت فایل، لطفاً ابتدا در کانال ما عضو شوید.',
                    { reply_markup: joinButton }
                );
            }
        } else {
            if (isMember) {
                await ctx.reply(
                    `سلام ${username || 'کاربر'} عزیز! 👋\n\n` +
                    'به ربات دانلود فایل خوش آمدید. برای دریافت فایل مورد نظر، لطفاً لینک آن را ارسال کنید.'
                );
            } else {
                const joinButton = {
                    inline_keyboard: [[
                        { text: '👥 عضویت در کانال', url: `https://t.me/${process.env.PUBLIC_CHANNEL_USERNAME}` },
                        { text: '✅ بررسی عضویت', callback_data: `check_membership_${userId}` }
                    ]]
                };

                await ctx.reply(
                    'برای دریافت فایل، لطفاً ابتدا در کانال ما عضو شوید.',
                    { reply_markup: joinButton }
                );
            }
        }
    } catch (error) {
        console.error('❌ Error handling start command:', error);
        await ctx.reply('متأسفانه خطایی رخ داد. لطفاً دوباره تلاش کنید.');
    }
}

/**
 * Handle membership check callback
 * @param {Object} ctx - Telegram context
 * @returns {Promise<void>}
 */
async function handleMembershipCheck(ctx) {
    try {
        const userId = ctx.from.id;
        const username = ctx.from.username;
        const isMember = await membershipService.isMember(userId);

        if (isMember) {
            await ctx.editMessageText(
                `سلام ${username || 'کاربر'} عزیز! 👋\n\n` +
                'به ربات دانلود فایل خوش آمدید. برای دریافت فایل مورد نظر، لطفاً لینک آن را ارسال کنید.'
            );

            // Process any pending file request
            const pendingLink = pendingLinks.get(userId);
            if (pendingLink) {
                pendingLinks.delete(userId);
                await fileHandlerService.sendFileToUser(ctx, pendingLink);
            }
        } else {
            const joinButton = {
                inline_keyboard: [[
                    { text: '👥 عضویت در کانال', url: `https://t.me/${process.env.PUBLIC_CHANNEL_USERNAME}` },
                    { text: '✅ بررسی عضویت', callback_data: `check_membership_${userId}` }
                ]]
            };

            await ctx.editMessageText(
                'برای دریافت فایل، لطفاً ابتدا در کانال ما عضو شوید.',
                { reply_markup: joinButton }
            );
        }
    } catch (error) {
        console.error('❌ Error handling membership check:', error);
        await ctx.editMessageText('متأسفانه خطایی رخ داد. لطفاً دوباره تلاش کنید.');
    }
}

module.exports = {
    setupHandlers,
    pendingLinks
}; 