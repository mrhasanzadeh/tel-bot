const membershipService = require('../services/membershipService');
const fileHandlerService = require('../services/fileHandlerService');
const { Markup } = require('telegraf');

// Store pending links for non-member users
const pendingLinks = new Map();

/**
 * Setup bot event handlers
 * @param {Object} bot - Telegraf bot instance
 * @returns {void}
 */
function setupHandlers(bot) {
    // Handle channel posts (new files)
    bot.on('channel_post', async (ctx) => {
        try {
            console.log('📥 Received channel post:', ctx.message);
            await fileHandlerService.handleNewFile(ctx);
        } catch (error) {
            console.error('❌ Error handling channel post:', error);
            // Don't throw the error to prevent webhook failure
        }
    });

    // Handle deleted messages
    bot.on('message', async (ctx) => {
        try {
            if (ctx.message && ctx.message.delete_chat_photo) {
                console.log('🗑️ Handling deleted message:', ctx.message);
                await fileHandlerService.handleDeletedMessage(ctx);
            }
        } catch (error) {
            console.error('❌ Error handling deleted message:', error);
            // Don't throw the error to prevent webhook failure
        }
    });

    // Handle /start command
    bot.command('start', async (ctx) => {
        try {
            console.log('👋 Handling /start command');
            const isMember = await membershipService.isMember(ctx.from.id);
            
            if (!isMember) {
                console.log('❌ User is not a member, sending join message');
                const joinButton = Markup.inlineKeyboard([
                    [Markup.button.url('عضویت در کانال', `https://t.me/${process.env.PUBLIC_CHANNEL_USERNAME}`)]
                ]);
                
                await ctx.reply(
                    'برای استفاده از ربات، لطفا ابتدا در کانال ما عضو شوید:',
                    joinButton
                );
                return;
            }
            
            console.log('✅ User is a member, sending welcome message');
            await ctx.reply('به ربات خوش آمدید! برای دریافت فایل، لینک آن را ارسال کنید.');
        } catch (error) {
            console.error('❌ Error handling /start command:', error);
            await ctx.reply('متأسفانه خطایی رخ داد. لطفاً دوباره تلاش کنید.');
        }
    });

    // Handle file requests
    bot.on('text', async (ctx) => {
        try {
            console.log('📝 Handling text message:', ctx.message.text);
            const isMember = await membershipService.isMember(ctx.from.id);
            
            if (!isMember) {
                console.log('❌ User is not a member, storing request');
                pendingLinks.set(ctx.from.id, ctx.message.text);
                
                const joinButton = Markup.inlineKeyboard([
                    [Markup.button.url('عضویت در کانال', `https://t.me/${process.env.PUBLIC_CHANNEL_USERNAME}`)]
                ]);
                
                await ctx.reply(
                    'برای دریافت فایل، لطفا ابتدا در کانال ما عضو شوید:',
                    joinButton
                );
                return;
            }
            
            console.log('✅ User is a member, processing file request');
            await fileHandlerService.handleFileRequest(ctx);
        } catch (error) {
            console.error('❌ Error handling file request:', error);
            await ctx.reply('متأسفانه خطایی رخ داد. لطفاً دوباره تلاش کنید.');
        }
    });

    // Handle callback queries (join button clicks)
    bot.on('callback_query', async (ctx) => {
        try {
            console.log('🔄 Handling callback query:', ctx.callbackQuery);
            const isMember = await membershipService.isMember(ctx.from.id);
            
            if (isMember) {
                console.log('✅ User joined, processing pending request');
                const pendingLink = pendingLinks.get(ctx.from.id);
                if (pendingLink) {
                    pendingLinks.delete(ctx.from.id);
                    await fileHandlerService.handleFileRequest(ctx, pendingLink);
                } else {
                    await ctx.reply('به ربات خوش آمدید! برای دریافت فایل، لینک آن را ارسال کنید.');
                }
            } else {
                console.log('❌ User still not a member');
                await ctx.answerCbQuery('لطفا ابتدا در کانال عضو شوید.');
            }
        } catch (error) {
            console.error('❌ Error handling callback query:', error);
            await ctx.answerCbQuery('متأسفانه خطایی رخ داد. لطفاً دوباره تلاش کنید.');
        }
    });
}

module.exports = {
    setupHandlers,
    pendingLinks
}; 