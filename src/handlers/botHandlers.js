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
            const chatId = ctx.chat.id;
            const messageId = ctx.channelPost.message_id;
            
            if (chatId && messageId && chatId.toString() === process.env.PRIVATE_CHANNEL_ID.toString()) {
                await fileHandlerService.handleNewFile(ctx);
            }
        } catch (error) {
            console.error('Error handling channel post:', error);
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
            console.error('Error handling message deletion:', error);
        }
    });

    // Handle /start command
    bot.command('start', handleStartCommand);

    // Handle membership check callback
    bot.action(/check_membership_(.+)/, handleMembershipCheck);
}

/**
 * Handle /start command
 * @param {Object} ctx - Telegram context
 * @returns {Promise<void>}
 */
async function handleStartCommand(ctx) {
    try {
        const userId = ctx.from.id;
        const username = ctx.from.username;
        const isMember = await membershipService.isMember(userId);

        if (isMember) {
            // If user is a member, send welcome message
            await ctx.reply(
                `سلام ${username || 'کاربر'} عزیز! 👋\n\n` +
                'به ربات دانلود فایل خوش آمدید. برای دریافت فایل مورد نظر، لطفاً لینک آن را ارسال کنید.'
            );
        } else {
            // If user is not a member, show join button
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

        // If there's a pending file request, process it
        const pendingLink = pendingLinks.get(userId);
        if (pendingLink) {
            pendingLinks.delete(userId);
            await fileHandlerService.handleFileRequest(ctx, pendingLink);
        }
    } catch (error) {
        console.error('Error handling start command:', error);
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
            // If user is now a member, send welcome message
            await ctx.editMessageText(
                `سلام ${username || 'کاربر'} عزیز! 👋\n\n` +
                'به ربات دانلود فایل خوش آمدید. برای دریافت فایل مورد نظر، لطفاً لینک آن را ارسال کنید.'
            );
        } else {
            // If user is still not a member, show join button again
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

        // If there's a pending file request, process it
        const pendingLink = pendingLinks.get(userId);
        if (pendingLink) {
            pendingLinks.delete(userId);
            await fileHandlerService.handleFileRequest(ctx, pendingLink);
        }
    } catch (error) {
        console.error('Error handling membership check:', error);
        await ctx.editMessageText('متأسفانه خطایی رخ داد. لطفاً دوباره تلاش کنید.');
    }
}

module.exports = {
    setupHandlers,
    pendingLinks
}; 