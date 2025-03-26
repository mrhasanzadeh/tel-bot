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
        await fileHandlerService.processChannelPost(ctx);
    });

    // Handle deleted channel messages
    bot.on('channel_post_deleted', async (ctx) => {
        if (ctx.update?.channel_post_deleted?.message_ids) {
            await fileHandlerService.handleDeletedMessages(ctx, ctx.update.channel_post_deleted.message_ids);
        }
    });

    // Handle /start command
    bot.command('start', handleStartCommand);

    // Handle membership check callback
    bot.action('check_membership', handleMembershipCheck);
}

/**
 * Handle /start command
 * @param {Object} ctx - Telegram context
 * @returns {Promise<void>}
 */
async function handleStartCommand(ctx) {
    try {
        const args = ctx.message.text.split(' ');
        // Check if it's a file request link
        if (args.length > 1 && args[1].startsWith('get_')) {
            const fileKey = args[1].replace('get_', '').toLowerCase();
            console.log('\n🔍 File Key Request:');
            console.log(`Key: ${fileKey}`);
            console.log(`User ID: ${ctx.from.id}`);
            
            const isMember = await membershipService.checkUserMembership(ctx);
            
            if (!isMember) {
                // Save link for user
                pendingLinks.set(ctx.from.id, fileKey);
                console.log(`User is not a member. Link saved for user ${ctx.from.id}`);
                await sendNotMemberMessage(ctx);
                return;
            }
            
            await fileHandlerService.sendFileToUser(ctx, fileKey);
        } else {
            // Show welcome message if not a file request
            const isMember = await membershipService.checkUserMembership(ctx);
            if (isMember) {
                await ctx.reply('👋 Welcome to Shiori Bot\n\nChannel address: https://t.me/+x5guW0j8thxlMTQ0', { disable_web_page_preview: true });
            } else {
                await sendNotMemberMessage(ctx);
            }
        }
    } catch (error) {
        console.error('Error handling start command:', error);
        await ctx.reply('⚠️ An error occurred. Please try again later.');
    }
}

/**
 * Handle membership check callback
 * @param {Object} ctx - Telegram context
 * @returns {Promise<void>}
 */
async function handleMembershipCheck(ctx) {
    try {
        const isMember = await membershipService.checkUserMembership(ctx);
        
        if (isMember) {
            await ctx.answerCbQuery('✅ Membership verified! You can now access files.', { show_alert: true });
            await ctx.editMessageText('✅ Membership verified! You can now access files.');
            
            // Check if user has a pending link
            const fileKey = pendingLinks.get(ctx.from.id);
            if (fileKey) {
                pendingLinks.delete(ctx.from.id);
                console.log(`Processing pending link for user ${ctx.from.id}: ${fileKey}`);
                
                // Delay sending file to avoid rate limits
                setTimeout(async () => {
                    await ctx.reply('📤 Sending your requested file...');
                    await fileHandlerService.sendFileToUser(ctx, fileKey);
                }, 1000);
            }
        } else {
            await sendNotMemberMessage(ctx);
        }
    } catch (error) {
        console.error('Error checking membership:', error);
        await ctx.answerCbQuery('⚠️ An error occurred. Please try again.', { show_alert: true });
    }
}

module.exports = {
    setupHandlers
}; 