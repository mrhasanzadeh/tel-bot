const membershipService = require('../services/membershipService');
const fileHandlerService = require('../services/fileHandlerService');
const { route: routeChannelFile } = require('../services/channelIntake');
const { buildChannelStatusReport } = require('../services/channelDiagnostics');
const { buildSecurityReport, ensurePollingMode } = require('../services/botSecurity');
const {
    isMonitoredChannelChat,
    getArchiveChannelId,
    getPrivateChannelId,
    getAdminUserId,
    normalizeChatId
} = require('../utils/channelIds');
const { e, escapeHtml, inlineButton } = require('../utils/premiumEmoji');
const botReply = require('../utils/botReply');
const scheduleService = require('../services/scheduleService');
const archiveMirrorService = require('../services/archiveMirrorService');

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
    // channel_post (broadcast) and message (supergroup) file uploads
    bot.use(async (ctx, next) => {
        const chat = ctx.chat;
        if (chat && (ctx.channelPost || ctx.message)) {
            const chatType = chat.type;
            if (chatType === 'channel' || chatType === 'supergroup') {
                const chatId = normalizeChatId(chat.id);
                const archiveId = getArchiveChannelId();
                const privateId = getPrivateChannelId();
                const hasFile = Boolean(
                    (ctx.channelPost || ctx.message)?.document ||
                    (ctx.channelPost || ctx.message)?.video ||
                    (ctx.channelPost || ctx.message)?.audio
                );
                console.log(
                    `👀 Channel update chat=${chatId} title="${chat.title || ''}" ` +
                        `type=${chatType} file=${hasFile} ` +
                        `matchArchive=${archiveId === chatId} matchPrivate=${privateId === chatId}`
                );
            }
        }

        try {
            const handled = await routeChannelFile(ctx, fileHandlerService);
            if (handled) return;
        } catch (error) {
            console.error('❌ Error routing channel file post:', error);
            if (error.response) {
                console.error('Telegram API:', error.response.description || error.response);
            }
        }
        return next();
    });

    // Handle deleted messages
    bot.on('message_delete', async (ctx) => {
        try {
            const chatId = ctx.chat.id;
            
            if (chatId && chatId.toString() === getPrivateChannelId()) {
                const messageIds = ctx.update?.message_delete?.message_ids || [];
                
                if (messageIds.length > 0) {
                    await fileHandlerService.handleDeletedMessages(ctx, messageIds);
                }
            }
        } catch (error) {
            console.error('❌ Error handling message deletion:', error);
        }
    });

    // Handle edited channel posts (private + archive file replace)
    const handleEditedChannelUpdate = async (ctx) => {
        try {
            const handled = await fileHandlerService.handleEditedChannelIntake(ctx);
            if (handled) {
                console.log('✅ Processed edited channel file update');
            }
        } catch (error) {
            console.error('❌ Error handling edited channel post:', error);
        }
    };

    bot.on('edited_channel_post', handleEditedChannelUpdate);
    bot.on('edited_message', handleEditedChannelUpdate);

    bot.command('checkchannels', async (ctx) => {
        if (ctx.chat?.type !== 'private') return;
        if (String(ctx.from?.id) !== getAdminUserId()) {
            await botReply.reply(ctx, `${e('error')} این دستور فقط برای ادمین است.`);
            return;
        }
        try {
            const report = await buildChannelStatusReport(bot);
            await ctx.reply(report);
        } catch (error) {
            console.error('checkchannels error:', error);
            await ctx.reply('خطا در بررسی کانال‌ها.');
        }
    });

    bot.command('mirroring', async (ctx) => {
        if (ctx.chat?.type !== 'private') return;
        if (String(ctx.from?.id) !== getAdminUserId()) {
            await botReply.reply(ctx, `${e('error')} این دستور فقط برای ادمین است.`);
            return;
        }

        const parts = String(ctx.message?.text ?? '')
            .trim()
            .split(/\s+/);
        const action = (parts[1] || 'status').toLowerCase();

        const statusWord = (enabled) => (enabled ? 'فعال' : 'غیرفعال');

        try {
            if (action === 'on' || action === 'enable') {
                await archiveMirrorService.setEnabled(true);
                await botReply.reply(
                    ctx,
                    `${e('success')} <b>کپی خودکار فعال شد</b>\n\n` +
                        `${e('download')} فایل‌های جدید کانال <b>آرشیو</b> دوباره به کانال <b>لینک</b> کپی می‌شوند.\n` +
                        `${e('check')} برای بررسی وضعیت: <code>/mirroring status</code>`
                );
                return;
            }

            if (action === 'off' || action === 'disable') {
                await archiveMirrorService.setEnabled(false);
                await botReply.reply(
                    ctx,
                    `${e('stop')} <b>کپی خودکار غیرفعال شد</b>\n\n` +
                        `${e('info')} پست‌های کانال آرشیو دیگر کپی نمی‌شوند.\n` +
                        `${e('check')} پست <b>مستقیم</b> در کانال لینک همچنان ثبت می‌شود.`
                );
                return;
            }

            if (action === 'reset') {
                await archiveMirrorService.resetToEnvDefault();
                const status = await archiveMirrorService.getStatus();
                await botReply.reply(
                    ctx,
                    `${e('success')} <b>تنظیم ادمین بازنشانی شد</b>\n\n` +
                        `${e('clipboard')} وضعیت فعلی: <b>${statusWord(status.enabled)}</b> (از .env)\n` +
                        `${e('info')} پیش‌فرض .env: <b>${statusWord(status.envDefault)}</b>`
                );
                return;
            }

            if (action !== 'status') {
                await botReply.reply(
                    ctx,
                    `${e('clipboard')} <b>راهنمای mirroring</b>\n\n` +
                        `<code>/mirroring status</code> — ${e('search')} وضعیت فعلی\n` +
                        `<code>/mirroring on</code> — ${e('success')} فعال‌سازی کپی\n` +
                        `<code>/mirroring off</code> — ${e('stop')} غیرفعال‌سازی کپی\n` +
                        `<code>/mirroring reset</code> — ${e('cool')} بازگشت به .env`
                );
                return;
            }

            const status = await archiveMirrorService.getStatus();
            const sourceLabel =
                status.source === 'admin'
                    ? `${e('bot')} تنظیم ادمین`
                    : `${e('clipboard')} فایل .env`;

            await botReply.reply(
                ctx,
                `${e('download')} <b>کپی آرشیو → کانال لینک</b>\n\n` +
                    `${e('info')} وضعیت: <b>${statusWord(status.enabled)}</b>\n` +
                    `منبع فعلی: ${sourceLabel}\n` +
                    `${e('timer')} پیش‌فرض .env: <b>${statusWord(status.envDefault)}</b>\n\n` +
                    `${e('megaphone')} <code>/mirroring off</code> · <code>/mirroring on</code>`
            );
        } catch (error) {
            console.error('mirroring command error:', error);
            await botReply.reply(ctx, `${e('error')} خطا در تغییر وضعیت mirroring.`);
        }
    });

    bot.command('security', async (ctx) => {
        if (ctx.chat?.type !== 'private') return;
        if (String(ctx.from?.id) !== getAdminUserId()) {
            await botReply.reply(ctx, `${e('error')} این دستور فقط برای ادمین است.`);
            return;
        }
        try {
            const report = await buildSecurityReport(bot);
            await ctx.reply(report);
        } catch (error) {
            console.error('security error:', error);
            await ctx.reply('خطا در بررسی امنیت بات.');
        }
    });

    bot.command('clearchwebhook', async (ctx) => {
        if (ctx.chat?.type !== 'private') return;
        if (String(ctx.from?.id) !== getAdminUserId()) {
            await botReply.reply(ctx, `${e('error')} این دستور فقط برای ادمین است.`);
            return;
        }
        try {
            const result = await ensurePollingMode(bot);
            if (result.hadWebhook) {
                await ctx.reply(
                    `${e('warning')} webhook حذف شد.\nURL قبلی:\n${result.previousUrl}\n\n` +
                        'اگر دوباره برگشت، توکن را در @BotFather revoke کنید.'
                );
            } else {
                await ctx.reply(`${e('success')} webhook تنظیم نشده — polling فعال است.`);
            }
        } catch (error) {
            console.error('clearchwebhook error:', error);
            await ctx.reply('خطا در حذف webhook.');
        }
    });

    bot.command('chatid', async (ctx) => {
        if (ctx.chat?.type !== 'private') return;
        if (String(ctx.from?.id) !== getAdminUserId()) {
            await botReply.reply(ctx, `${e('error')} این دستور فقط برای ادمین است.`);
            return;
        }
        const replied = ctx.message.reply_to_message;
        const origin = replied?.forward_origin;
        const legacyChat = replied?.forward_from_chat;

        if (origin?.type === 'channel' && origin.chat) {
            await ctx.reply(
                `کانال مبدأ:\nشناسه: ${origin.chat.id}\nعنوان: ${origin.chat.title || '-'}\n\n` +
                    `در .env:\nLINKS_CHANNEL_ID=${origin.chat.id}`
            );
            return;
        }

        if (legacyChat?.id) {
            await ctx.reply(
                `کانال مبدأ:\nشناسه: ${legacyChat.id}\nعنوان: ${legacyChat.title || '-'}\n\n` +
                    `در .env:\nLINKS_CHANNEL_ID=${legacyChat.id}`
            );
            return;
        }

        await ctx.reply(
            'یک پیام (مثلاً همان فایل) را از کانال آرشیو به این چت فوروارد کنید، روی همان پیام Reply بزنید و دوباره /chatid را بفرستید.'
        );
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
        const actorId = String(ctx.from.id);
        const callbackUserId = String(ctx.match[1]);

        if (callbackUserId !== actorId) {
            await ctx.answerCbQuery('این دکمه برای شما نیست.', { show_alert: true });
            return;
        }

        const { isAllMember, memberships } = await membershipService.isMember(actorId);

        if (isAllMember) {
            await ctx.answerCbQuery();
            await botReply.editMessageText(
                ctx,
                `${e('success')} شما در همه کانال‌ها عضو هستید. حالا می‌توانید فایل‌ها را دریافت کنید.`
            );
            const pendingLink = pendingLinks.get(actorId);
            if (pendingLink) {
                if (typeof pendingLink === 'object' && pendingLink.kind === 'pack') {
                    startPackSend(ctx, pendingLink.value, actorId);
                } else if (typeof pendingLink === 'object' && pendingLink.kind === 'file') {
                    await fileHandlerService.sendFileToUser(ctx, pendingLink.value);
                } else if (typeof pendingLink === 'string') {
                    await fileHandlerService.sendFileToUser(ctx, pendingLink);
                }
                pendingLinks.delete(actorId);
            }
        } else {
            await ctx.answerCbQuery();
            const message = createMembershipMessage(memberships);
            await botReply.editMessageText(ctx, message, { reply_markup: createJoinButtons(actorId) });
        }
    });

    // Schedule release approval (admin only)
    bot.action(/^sched_a_(\d+)$/, async (ctx) => {
        await scheduleService.handleApproval(ctx, Number(ctx.match[1]), 'approve');
    });
    bot.action(/^sched_c_(\d+)$/, async (ctx) => {
        await scheduleService.handleApproval(ctx, Number(ctx.match[1]), 'complete');
    });
    bot.action(/^sched_r_(\d+)$/, async (ctx) => {
        await scheduleService.handleApproval(ctx, Number(ctx.match[1]), 'reject');
    });
    bot.action(/^sched_rep_(\d+)$/, async (ctx) => {
        await scheduleService.handleRepublish(ctx, Number(ctx.match[1]));
    });

    bot.action(/^areg_syn_y_(.+)$/, async (ctx) => {
        await scheduleService.handleAnimeRegSynopsisChoice(ctx, true);
    });
    bot.action(/^areg_syn_n_(.+)$/, async (ctx) => {
        await scheduleService.handleAnimeRegSynopsisChoice(ctx, false);
    });
    bot.action(/^areg_sub_ep_(.+)$/, async (ctx) => {
        await scheduleService.handleAnimeRegSubtitleModeChoice(ctx, 'per_episode');
    });
    bot.action(/^areg_sub_pk_(.+)$/, async (ctx) => {
        await scheduleService.handleAnimeRegSubtitleModeChoice(ctx, 'pack_only');
    });
    bot.action(/^areg_kar_y_(.+)$/, async (ctx) => {
        await scheduleService.handleAnimeRegKaraokeChoice(ctx, true);
    });
    bot.action(/^areg_kar_n_(.+)$/, async (ctx) => {
        await scheduleService.handleAnimeRegKaraokeChoice(ctx, false);
    });

    // Cancel active pack send via inline button or /cancel
    bot.action(/cancel_pack_(.+)/, async (ctx) => {
        await handlePackCancelRequest(ctx, String(ctx.match[1]));
    });

    bot.command('cancel', async (ctx) => {
        await handlePackCancelRequest(ctx, String(ctx.from.id));
    });

    // Schedule cover photo from admin (new anime without template post)
    bot.on(['photo', 'document'], async (ctx) => {
        try {
            if (isMonitoredChannelChat(ctx)) return;
            if (String(ctx.from?.id) !== getAdminUserId()) return;
            await scheduleService.handleAdminCoverPhoto(ctx);
        } catch (error) {
            console.error('❌ Schedule cover photo handler:', error);
        }
    });

    // Handle file requests (private chats only — not archive/supergroup channels)
    bot.on('text', async (ctx) => {
        try {
            if (isMonitoredChannelChat(ctx)) return;

            if (String(ctx.from.id) === getAdminUserId()) {
                const handledReg = await scheduleService.handleAdminAnimeRegistration(ctx);
                if (handledReg) return;

                const handledPack = await scheduleService.handleAdminPackInfo(ctx);
                if (handledPack) return;
            }

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