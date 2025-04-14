const membershipService = require('../services/membershipService');
const fileHandlerService = require('../services/fileHandlerService');

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
        try {
            const userId = ctx.from.id;
            const { isAllMember, memberships } = await membershipService.isMember(userId);

            if (isAllMember) {
                await ctx.editMessageText(
                    `🤖 به ربات شیوری خوش آمدید.\n\n🔍 کانال‌های ما:\n• https://t.me/${process.env.PUBLIC_CHANNEL_USERNAME}\n• https://t.me/${process.env.ADDITIONAL_CHANNEL_USERNAME}`,
                    { disable_web_page_preview: true }
                );

                // Process any pending file request
                const pendingLink = pendingLinks.get(userId);
                if (pendingLink) {
                    pendingLinks.delete(userId);
                    await fileHandlerService.sendFileToUser(ctx, pendingLink);
                }
            } else {
                await ctx.editMessageText(
                    createMembershipMessage(memberships),
                    { reply_markup: createJoinButtons(userId) }
                );
            }
        } catch (error) {
            console.error('❌ Error handling membership check:', error);
            await ctx.editMessageText('متأسفانه خطایی رخ داد. لطفاً دوباره تلاش کنید.');
        }
    });

    // Handle direct file requests
    bot.on('text', async (ctx) => {
        try {
            const text = ctx.message.text;
            if (text.startsWith('get_')) {
                const fileKey = text.replace('get_', '');
                console.log(`🔍 Processing file request for key: ${fileKey}`);
                
                // Check if user is a member of all channels
                const { isAllMember, memberships } = await membershipService.isMember(ctx.from.id);
                
                if (isAllMember) {
                    await fileHandlerService.sendFileToUser(ctx, fileKey);
                } else {
                    // Store the file request for later
                    pendingLinks.set(ctx.from.id, fileKey);
                    console.log(`📝 Stored pending file request for user ${ctx.from.id}`);
                    
                    await ctx.reply(
                        createMembershipMessage(memberships),
                        { reply_markup: createJoinButtons(ctx.from.id) }
                    );
                }
            }
        } catch (error) {
            console.error('❌ Error handling file request:', error);
            await ctx.reply('متأسفانه خطایی رخ داد. لطفاً دوباره تلاش کنید.');
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