const membershipService = require('../services/membershipService');
const fileHandlerService = require('../services/fileHandlerService');
const databaseService = require('../services/databaseService');

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
    bot.command('start', async (ctx) => {
        try {
            console.log('🚀 Handling start command');
            const userId = ctx.from.id;
            const startPayload = ctx.message.text.split(' ')[1];

            // Check if user is a member of all channels
            const { isAllMember, memberships } = await membershipService.isMember(userId);
            console.log(`👤 User ${userId} membership status: ${isAllMember}`);

            if (startPayload && startPayload.startsWith('get_')) {
                const fileKey = startPayload.replace('get_', '');
                console.log(`📥 Processing file request for key: ${fileKey}`);
                
                if (isAllMember) {
                    await fileHandlerService.sendFileToUser(ctx, fileKey);
                } else {
                    // Store the file request for later
                    pendingLinks.set(userId, fileKey);
                    console.log(`📝 Stored pending file request for user ${userId}`);
                    
                    await ctx.reply(
                        createMembershipMessage(memberships),
                        { reply_markup: createJoinButtons(userId) }
                    );
                }
            } else {
                if (isAllMember) {
                    await ctx.reply(
                        `🤖 به ربات شیوری خوش آمدید.\n\n🔍 کانال‌های ما:\n• https://t.me/${process.env.PUBLIC_CHANNEL_USERNAME}\n• https://t.me/${process.env.ADDITIONAL_CHANNEL_USERNAME}`,
                        { disable_web_page_preview: true }
                    );
                } else {
                    await ctx.reply(
                        createMembershipMessage(memberships),
                        { reply_markup: createJoinButtons(userId) }
                    );
                }
            }
        } catch (error) {
            console.error('❌ Error handling start command:', error);
            await ctx.reply('متأسفانه خطایی رخ داد. لطفاً دوباره تلاش کنید.');
        }
    });

    // Handle membership check callback
    bot.action(/check_membership_(.+)/, async (ctx) => {
        const userId = ctx.match[1];
        const memberships = await membershipService.isMember(userId);
        const allMemberships = Object.values(memberships);
        const isMember = allMemberships.every(m => m.isMember);

        if (isMember) {
            await ctx.editMessageText('✅ شما در همه کانال‌ها عضو هستید. حالا می‌توانید فایل‌ها را دریافت کنید.');
            const pendingLink = pendingLinks.get(userId);
            if (pendingLink) {
                await fileHandlerService.sendFileToUser(userId, pendingLink);
                pendingLinks.delete(userId);
            }
        } else {
            const message = createMembershipMessage(memberships);
            await ctx.editMessageText(message, createJoinButtons(userId));
        }
    });

    // Handle file requests
    bot.on('text', async (ctx) => {
        try {
            const userId = ctx.from.id;
            const memberships = await membershipService.isMember(userId);
            const allMemberships = Object.values(memberships);
            const isMember = allMemberships.every(m => m.isMember);

            if (!isMember) {
                // Store the link for later use
                pendingLinks.set(userId, ctx.message.text);
                
                // Send membership status and join buttons
                const message = createMembershipMessage(memberships);
                await ctx.reply(message, createJoinButtons(userId));
                return;
            }

            // User is a member, send the file
            await fileHandlerService.sendFileToUser(userId, ctx.message.text);
        } catch (error) {
            console.error('❌ Error handling file request:', error);
            await ctx.reply('متأسفانه خطایی رخ داد. لطفاً دوباره تلاش کنید.');
        }
    });

    // Handle /stats command
    bot.command('stats', async (ctx) => {
        try {
            // Check if user is admin
            if (ctx.from.id.toString() !== process.env.ADMIN_USER_ID) {
                await ctx.reply('❌ شما دسترسی به این دستور را ندارید.');
                return;
            }

            const files = await databaseService.getAllFiles(100); // Get last 100 files
            if (!files || files.length === 0) {
                await ctx.reply('📊 هیچ فایلی برای نمایش آمار وجود ندارد.');
                return;
            }

            // Sort files by download count
            files.sort((a, b) => b.downloads - a.downloads);

            // Create statistics message
            let statsMessage = '📊 آمار دانلود فایل‌ها:\n\n';
            
            files.forEach((file, index) => {
                statsMessage += `${index + 1}. ${file.fileName || 'بدون نام'}\n`;
                statsMessage += `   🔑 کد: ${file.key}\n`;
                statsMessage += `   📥 تعداد دانلود: ${file.downloads}\n`;
                statsMessage += `   📅 تاریخ: ${new Date(file.date).toLocaleString('fa-IR')}\n`;
                statsMessage += `   🔗 لینک: https://t.me/${ctx.botInfo.username}?start=get_${file.key}\n\n`;
            });

            // Split message if it's too long
            const maxLength = 4000;
            if (statsMessage.length > maxLength) {
                const parts = [];
                while (statsMessage.length > 0) {
                    parts.push(statsMessage.substring(0, maxLength));
                    statsMessage = statsMessage.substring(maxLength);
                }
                
                for (const part of parts) {
                    await ctx.reply(part);
                }
            } else {
                await ctx.reply(statsMessage);
            }
        } catch (error) {
            console.error('❌ Error handling stats command:', error);
            await ctx.reply('❌ خطایی در دریافت آمار رخ داد.');
        }
    });
}

/**
 * Create join buttons for all required channels
 * @returns {Object} Telegram inline keyboard markup
 */
function createJoinButtons(userId) {
    return {
        inline_keyboard: [
            [
                { text: '👥 عضویت در کانال اول', url: `https://t.me/${process.env.PUBLIC_CHANNEL_USERNAME}` },
                { text: '👥 عضویت در کانال دوم', url: `https://t.me/${process.env.ADDITIONAL_CHANNEL_USERNAME}` }
            ],
            [
                { text: '✅ بررسی عضویت', callback_data: `check_membership_${userId}` }
            ]
        ]
    };
}

/**
 * Create membership status message
 * @param {Object} memberships - Membership status for each channel
 * @returns {string} Status message
 */
function createMembershipMessage(memberships) {
    let message = '📢 وضعیت عضویت شما:\n\n';
    
    for (const [username, status] of Object.entries(memberships)) {
        const emoji = status.isMember ? '✅' : '❌';
        message += `${emoji} ${status.name}\n`;
    }
    
    message += '\nبرای دریافت فایل، لطفاً در همه کانال‌ها عضو شوید.';
    return message;
}

module.exports = {
    setupHandlers,
    pendingLinks
}; 