const membershipService = require('../services/membershipService');
const fileHandlerService = require('../services/fileHandlerService');

// Store pending links for non-member users
const pendingLinks = new Map();

// Store active pack send operations per user for cancellation
const activePackSends = new Map();

function parseRequest(input) {
    if (!input) return null;

    const text = String(input).trim();
    if (!text) return null;

    // Full direct link: https://t.me/<bot>?start=pack_<slug>
    const packStartMatch = text.match(/[?&]start=(pack_[^\s]+)/i);
    if (packStartMatch && packStartMatch[1]) {
        return parseRequest(packStartMatch[1]);
    }

    // pack_<slug>
    if (text.startsWith('pack_')) {
        const slug = text.slice('pack_'.length).trim();
        if (!slug) return null;
        return { kind: 'pack', value: slug };
    }

    const fileKey = extractFileKey(text);
    if (!fileKey) return null;
    return { kind: 'file', value: fileKey };
}

function extractFileKey(input) {
    if (!input) return '';

    const text = String(input).trim();
    if (!text) return '';

    // /start get_<key>
    if (text.startsWith('get_')) {
        return text.slice('get_'.length).trim();
    }

    // Full direct link: https://t.me/<bot>?start=get_<key>
    const startMatch = text.match(/[?&]start=(get_[^\s]+)/i);
    if (startMatch && startMatch[1]) {
        return extractFileKey(startMatch[1]);
    }

    // Any token containing get_<key>
    const tokenMatch = text.match(/get_([^\s]+)/i);
    if (tokenMatch && tokenMatch[1]) {
        return tokenMatch[1].trim();
    }

    // Otherwise assume user pasted the key itself
    return text;
}

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

    // Handle edited channel posts
    bot.on('edited_channel_post', async (ctx) => {
        try {
            const chatId = ctx.chat.id;
            const messageId = ctx.editedChannelPost.message_id;
            if (chatId && messageId && chatId.toString() === process.env.PRIVATE_CHANNEL_ID.toString()) {
                console.log('✏️ Processing edited file in private channel');
                await fileHandlerService.handleEditedFile(ctx);
            }
        } catch (error) {
            console.error('❌ Error handling edited channel post:', error);
        }
    });

    // Handle /start command
    bot.command('start', async (ctx) => {
        try {
            console.log('🚀 Handling start command');
            const userId = String(ctx.from.id);
            const startPayload = ctx.message.text.split(' ')[1];

            // Allow cancelling active pack sends
            if (startPayload && String(startPayload).trim().toLowerCase() === 'cancel') {
                const token = activePackSends.get(userId);
                if (token) {
                    token.cancelled = true;
                    activePackSends.delete(userId);
                    await ctx.reply('⛔️ ارسال پک متوقف شد.');
                } else {
                    await ctx.reply('ℹ️ ارسال فعالی برای متوقف کردن وجود ندارد.');
                }
                return;
            }

            // Check if user is a member of all channels
            const { isAllMember, memberships } = await membershipService.isMember(userId);
            console.log(`👤 User ${userId} membership status: ${isAllMember}`);

            const req = parseRequest(startPayload);
            if (req) {
                console.log(`📥 Processing request kind=${req.kind} value=${req.value}`);

                if (isAllMember) {
                    if (req.kind === 'pack') {
                        const token = { cancelled: false };
                        activePackSends.set(userId, token);
                        await fileHandlerService.sendPackToUser(ctx, req.value, token);
                        activePackSends.delete(userId);
                    } else {
                        await fileHandlerService.sendFileToUser(ctx, req.value);
                    }
                } else {
                    // Store the request for later
                    pendingLinks.set(userId, req);
                    console.log(`📝 Stored pending request for user ${userId}`);

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
        const userId = String(ctx.match[1]);
        const { isAllMember, memberships } = await membershipService.isMember(userId);

        if (isAllMember) {
            await ctx.editMessageText('✅ شما در همه کانال‌ها عضو هستید. حالا می‌توانید فایل‌ها را دریافت کنید.');
            const pendingLink = pendingLinks.get(userId);
            if (pendingLink) {
                if (typeof pendingLink === 'object' && pendingLink.kind === 'pack') {
                    const token = { cancelled: false };
                    activePackSends.set(userId, token);
                    await fileHandlerService.sendPackToUser(ctx, pendingLink.value, token);
                    activePackSends.delete(userId);
                } else if (typeof pendingLink === 'object' && pendingLink.kind === 'file') {
                    await fileHandlerService.sendFileToUser(ctx, pendingLink.value);
                } else if (typeof pendingLink === 'string') {
                    await fileHandlerService.sendFileToUser(ctx, pendingLink);
                }
                pendingLinks.delete(userId);
            }
        } else {
            const message = createMembershipMessage(memberships);
            await ctx.editMessageText(message, { reply_markup: createJoinButtons(userId) });
        }
    });

    // Allow cancelling an active pack send
    bot.command('cancel', async (ctx) => {
        const userId = String(ctx.from.id);
        const token = activePackSends.get(userId);
        if (token) {
            token.cancelled = true;
            activePackSends.delete(userId);
            await ctx.reply('⛔️ ارسال پک متوقف شد.');
        } else {
            await ctx.reply('ℹ️ ارسال فعالی برای متوقف کردن وجود ندارد.');
        }
    });

    // Handle file requests
    bot.on('text', async (ctx) => {
        try {
            const userId = String(ctx.from.id);
            const { isAllMember, memberships } = await membershipService.isMember(userId);

            const req = parseRequest(ctx.message.text);
            if (!req) {
                await ctx.reply('⚠️ کلید/پک معتبر نیست.');
                return;
            }

            if (!isAllMember) {
                // Store the link for later use
                pendingLinks.set(userId, req);
                
                // Send membership status and join buttons
                const message = createMembershipMessage(memberships);
                await ctx.reply(message, { reply_markup: createJoinButtons(userId) });
                return;
            }

            // User is a member
            if (req.kind === 'pack') {
                const token = { cancelled: false };
                activePackSends.set(userId, token);
                await fileHandlerService.sendPackToUser(ctx, req.value, token);
                activePackSends.delete(userId);
            } else {
                await fileHandlerService.sendFileToUser(ctx, req.value);
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