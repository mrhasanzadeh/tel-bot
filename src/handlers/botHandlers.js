const membershipService = require('../services/membershipService');
const fileHandlerService = require('../services/fileHandlerService');
const { e, escapeHtml, inlineButton } = require('../utils/premiumEmoji');
const botReply = require('../utils/botReply');

// Store pending links for non-member users
const pendingLinks = new Map();

// Store active pack send operations per user for cancellation
const activePackSends = new Map();

/**
 * Start pack send without blocking the update handler (so /cancel can run in parallel).
 * @param {import('telegraf').Context} ctx
 * @param {string} packSlug
 * @param {string} userId
 */
function startPackSend(ctx, packSlug, userId) {
    const existing = activePackSends.get(userId);
    if (existing) {
        existing.cancelled = true;
    }

    const token = { cancelled: false };
    activePackSends.set(userId, token);

    fileHandlerService
        .sendPackToUser(ctx, packSlug, token)
        .catch((error) => {
            console.error('❌ Error in background pack send:', error);
            botReply.reply(ctx, 'متأسفانه خطایی رخ داد. لطفاً دوباره تلاش کنید.').catch(() => {});
        })
        .finally(() => {
            if (activePackSends.get(userId) === token) {
                activePackSends.delete(userId);
            }
        });
}

/**
 * @param {string} userId
 * @returns {boolean} Whether a pack send was marked for cancellation
 */
function requestPackCancel(userId) {
    const token = activePackSends.get(userId);
    if (!token || token.cancelled) return false;
    token.cancelled = true;
    return true;
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {string} userId
 */
async function handlePackCancelRequest(ctx, userId) {
    if (String(ctx.from.id) !== userId) {
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery('این دکمه برای شما نیست.', { show_alert: true });
        }
        return;
    }

    if (requestPackCancel(userId)) {
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery('در حال توقف ارسال پک...');
            try {
                await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
            } catch {
                // message may already be edited or deleted
            }
        } else {
            await botReply.reply(ctx, `${e('stop')} در حال توقف ارسال پک...`);
        }
        return;
    }

    if (ctx.callbackQuery) {
        await ctx.answerCbQuery('ارسال فعالی برای متوقف کردن وجود ندارد.', { show_alert: true });
    } else {
        await botReply.reply(ctx, `${e('info')} ارسال فعالی برای متوقف کردن وجود ندارد.`);
    }
}

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
                await handlePackCancelRequest(ctx, userId);
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
                        startPackSend(ctx, req.value, userId);
                    } else {
                        await fileHandlerService.sendFileToUser(ctx, req.value);
                    }
                } else {
                    // Store the request for later
                    pendingLinks.set(userId, req);
                    console.log(`📝 Stored pending request for user ${userId}`);

                    await botReply.reply(
                        ctx,
                        createMembershipMessage(memberships),
                        { reply_markup: createJoinButtons(userId) }
                    );
                }
            } else {
                if (isAllMember) {
                    await botReply.reply(
                        ctx,
                        `${e('bot')} به ربات شیوری خوش آمدید.\n\n${e('search')} کانال‌های ما:\n• https://t.me/${process.env.PUBLIC_CHANNEL_USERNAME}\n• https://t.me/${process.env.ADDITIONAL_CHANNEL_USERNAME}`,
                        { disable_web_page_preview: true }
                    );
                } else {
                    await botReply.reply(
                        ctx,
                        createMembershipMessage(memberships),
                        { reply_markup: createJoinButtons(userId) }
                    );
                }
            }
        } catch (error) {
            console.error('❌ Error handling start command:', error);
            await botReply.reply(ctx, 'متأسفانه خطایی رخ داد. لطفاً دوباره تلاش کنید.');
        }
    });

    // Handle membership check callback
    bot.action(/check_membership_(.+)/, async (ctx) => {
        const userId = String(ctx.match[1]);
        const { isAllMember, memberships } = await membershipService.isMember(userId);

        if (isAllMember) {
            await botReply.editMessageText(ctx, `${e('success')} شما در همه کانال‌ها عضو هستید. حالا می‌توانید فایل‌ها را دریافت کنید.`);
            const pendingLink = pendingLinks.get(userId);
            if (pendingLink) {
                if (typeof pendingLink === 'object' && pendingLink.kind === 'pack') {
                    startPackSend(ctx, pendingLink.value, userId);
                } else if (typeof pendingLink === 'object' && pendingLink.kind === 'file') {
                    await fileHandlerService.sendFileToUser(ctx, pendingLink.value);
                } else if (typeof pendingLink === 'string') {
                    await fileHandlerService.sendFileToUser(ctx, pendingLink);
                }
                pendingLinks.delete(userId);
            }
        } else {
            const message = createMembershipMessage(memberships);
            await botReply.editMessageText(ctx, message, { reply_markup: createJoinButtons(userId) });
        }
    });

    // Cancel active pack send via inline button or /cancel
    bot.action(/cancel_pack_(.+)/, async (ctx) => {
        await handlePackCancelRequest(ctx, String(ctx.match[1]));
    });

    bot.command('cancel', async (ctx) => {
        await handlePackCancelRequest(ctx, String(ctx.from.id));
    });

    // Handle file requests
    bot.on('text', async (ctx) => {
        try {
            const userId = String(ctx.from.id);
            const { isAllMember, memberships } = await membershipService.isMember(userId);

            const req = parseRequest(ctx.message.text);
            if (!req) {
                await botReply.reply(ctx, `${e('warning')} کلید/پک معتبر نیست.`);
                return;
            }

            if (!isAllMember) {
                // Store the link for later use
                pendingLinks.set(userId, req);
                
                // Send membership status and join buttons
                const message = createMembershipMessage(memberships);
                await botReply.reply(ctx, message, { reply_markup: createJoinButtons(userId) });
                return;
            }

            // User is a member
            if (req.kind === 'pack') {
                startPackSend(ctx, req.value, userId);
            } else {
                await fileHandlerService.sendFileToUser(ctx, req.value);
            }
        } catch (error) {
            console.error('❌ Error handling file request:', error);
            await botReply.reply(ctx, 'متأسفانه خطایی رخ داد. لطفاً دوباره تلاش کنید.');
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
                inlineButton({
                    text: 'عضویت در کانال اول',
                    emojiKey: 'users',
                    url: `https://t.me/${process.env.PUBLIC_CHANNEL_USERNAME}`
                }),
                inlineButton({
                    text: 'عضویت در کانال دوم',
                    emojiKey: 'users',
                    url: `https://t.me/${process.env.ADDITIONAL_CHANNEL_USERNAME}`
                })
            ],
            [
                inlineButton({
                    text: 'بررسی عضویت',
                    emojiKey: 'success',
                    callback_data: `check_membership_${userId}`
                })
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
    let message = `${e('megaphone')} وضعیت عضویت شما:\n\n`;

    for (const [, status] of Object.entries(memberships)) {
        const emoji = status.isMember ? e('success') : e('error');
        message += `${emoji} ${escapeHtml(status.name)}\n`;
    }

    message += '\nبرای دریافت فایل، لطفاً در همه کانال‌ها عضو شوید.';
    return message;
}

module.exports = {
    setupHandlers,
    pendingLinks
};