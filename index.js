/**
 * Telegram Bot for file sharing
 * 
 * This bot allows files to be shared through a restricted system where:
 * 1. Files are posted in a private channel
 * 2. Bot generates unique access keys for each file
 * 3. Users must join a public channel to access files
 * 4. Each file can be tracked for download statistics
 * 5. Files are automatically deactivated when posts are deleted
 */

const { Telegraf, Markup } = require('telegraf');
const https = require('https');
const config = require('./config');
const databaseService = require('./src/services/databaseService');
const fileHandlerService = require('./src/services/fileHandlerService');
const { setupHandlers } = require('./src/handlers/botHandlers');
const { markMessageDeleted } = require('./src/utils/fileUtils');
const membershipService = require('./src/services/membershipService');
const express = require('express');

// ذخیره‌سازی لینک‌های ارسال شده توسط کاربران غیرعضو
const pendingLinks = new Map();

// Helper function to format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Create Express app
const app = express();
app.use(express.json());

// Validate required environment variables
const requiredEnvVars = [
    'BOT_TOKEN',
    'MONGODB_URI',
    'PRIVATE_CHANNEL_ID',
    'PUBLIC_CHANNEL_ID',
    'PUBLIC_CHANNEL_USERNAME',
    'ADDITIONAL_CHANNEL_USERNAME'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
    console.error(`❌ Missing required environment variables: ${missingEnvVars.join(', ')}`);
    throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

// Initialize bot with token from config
const bot = new Telegraf(process.env.BOT_TOKEN, {
    telegram: {
        apiRoot: 'https://api.telegram.org'
    }
});

// Set up membership service with bot instance
membershipService.setTelegram(bot);

// Connect to MongoDB
databaseService.connect()
    .then(() => {
        console.log('✅ Connected to MongoDB');
    })
    .catch(error => {
        console.error('❌ MongoDB connection error:', error);
        throw error;
    });

// تولید کلید تصادفی
function generateFileKey() {
    const key = Math.floor(100000000 + Math.random() * 900000000).toString();
    console.log(`Generated Key: ${key}`);
    return key;
}

// ایجاد دکمه‌های شیشه‌ای
const getSubscriptionKeyboard = (userId) => {
    return Markup.inlineKeyboard([
        [
            Markup.button.url('📢 عضویت در کانال اول', `https://t.me/${config.PUBLIC_CHANNEL_USERNAME}`),
            Markup.button.url('📢 عضویت در کانال دوم', `https://t.me/${config.ADDITIONAL_CHANNEL_USERNAME}`)
        ],
        [Markup.button.callback('✅ بررسی عضویت', `check_membership_${userId}`)]
    ]);
};

// بررسی عضویت کاربر در کانال‌ها
async function checkUserMembership(ctx) {
    try {
        const { isAllMember } = await membershipService.isMember(ctx.from.id);
        return isAllMember;
    } catch (error) {
        console.error('❌ Error checking membership:', error);
        return false;
    }
}

// ارسال پیام عدم عضویت با دکمه‌های شیشه‌ای
async function sendNotMemberMessage(ctx) {
    try {
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery('⚠️ هنوز توی بعضی از کانال‌ها عضو نشدی! لطفاً توی همه عضو شو، بعد دکمه رو بزن.', { show_alert: true, cache_time: 0 });
            await ctx.editMessageText('📢 برای عضویت در کانال‌ها، روی دکمه‌های زیر کلیک کنید:', getSubscriptionKeyboard(ctx.from.id));
        } else {
            await ctx.reply('📢 برای عضویت در کانال‌ها، روی دکمه‌های زیر کلیک کنید:', getSubscriptionKeyboard(ctx.from.id));
        }
    } catch (error) {
        console.error('Error sending not member message:', error);
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery('⚠️ خطا در ارسال پیام', { show_alert: true, cache_time: 0 });
        }
    }
}

// تابع تأخیر
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// پردازش پیام‌های کانال خصوصی
bot.on('channel_post', async (ctx) => {
    try {
        const chatId = ctx.chat.id;
        const channelId = process.env.PRIVATE_CHANNEL_ID;
        
        if (chatId.toString() === channelId) {
            const message = ctx.channelPost;
            const fileKey = generateFileKey();
            
            console.log('\n📨 Processing New Channel Post:');
            console.log(`Message ID: ${message.message_id}`);
            console.log(`Generated Key: ${fileKey}`);
            
            // Create direct link
            const botUsername = bot.botInfo?.username;
            const directLink = `https://t.me/${botUsername}?start=get_${fileKey}`;
            
            // Store message information
            let fileData = {
                key: fileKey,
                messageId: message.message_id,
                type: 'text',
                date: Date.now(),
                isActive: true,
                downloads: 0
            };

            // Handle different message types
            if (message.document) {
                fileData.type = 'document';
                fileData.fileId = message.document.file_id;
                fileData.fileName = message.document.file_name;
                fileData.fileSize = message.document.file_size;
                console.log(`Document Info: ${fileData.fileName} (${formatFileSize(fileData.fileSize)})`);
            } else if (message.photo) {
                fileData.type = 'photo';
                fileData.fileId = message.photo[message.photo.length - 1].file_id;
                fileData.fileName = 'photo.jpg';
                fileData.fileSize = 0;
                console.log('Photo Message');
            } else if (message.video) {
                fileData.type = 'video';
                fileData.fileId = message.video.file_id;
                fileData.fileName = 'video.mp4';
                fileData.fileSize = message.video.file_size || 0;
                console.log('Video Message');
            } else if (message.audio) {
                fileData.type = 'audio';
                fileData.fileId = message.audio.file_id;
                fileData.fileName = message.audio.file_name || 'audio.mp3';
                fileData.fileSize = message.audio.file_size || 0;
                console.log('Audio Message');
            }

            // ذخیره اطلاعات فایل در دیتابیس
            await databaseService.createFile(fileData);
            console.log(`Stored Message Info for Key: ${fileKey}`);

            // ویرایش کپشن پیام با تأخیر و تلاش مجدد
            let retryCount = 0;
            const maxRetries = 3;
            const baseDelay = 2000; // 2 seconds

            while (retryCount < maxRetries) {
                try {
                    const caption = message.caption || '';
                    const newCaption = `${caption}\n\n🔑 Key: ${fileKey}\n🔗 Direct Link: ${directLink}`;
                    await ctx.telegram.editMessageCaption(channelId, message.message_id, null, newCaption);
                    console.log(`Successfully updated caption for message ${message.message_id}`);
                    break;
                } catch (error) {
                    retryCount++;
                    if (error.message.includes('429')) {
                        const retryAfter = parseInt(error.message.match(/retry after (\d+)/)[1]) * 1000;
                        console.log(`Rate limit hit. Waiting ${retryAfter}ms before retry ${retryCount}/${maxRetries}`);
                        await delay(retryAfter);
                    } else {
                        console.error(`Error updating caption (attempt ${retryCount}/${maxRetries}):`, error.message);
                        if (retryCount < maxRetries) {
                            await delay(baseDelay * retryCount);
                        }
                    }
                }
            }

            if (retryCount === maxRetries) {
                console.error(`Failed to update caption for message ${message.message_id} after ${maxRetries} attempts`);
                // ارسال پیام جدید با لینک
                try {
                    await ctx.telegram.sendMessage(channelId, 
                        `🔑 Key: ${fileKey}\n🔗 Direct Link: ${directLink}\n📅 Date: ${new Date().toLocaleString('en-US')}`,
                        { reply_to_message_id: message.message_id }
                    );
                } catch (error) {
                    console.error('Error sending new message with link:', error.message);
                }
            }
        }
    } catch (error) {
        console.error('Error processing channel post:', error.message);
    }
});

// پردازش دستور /start
bot.command('start', async (ctx) => {
    try {
        const args = ctx.message.text.split(' ');
        // بررسی آیا لینک دریافت فایل است
        if (args.length > 1 && args[1].startsWith('get_')) {
            const fileKey = args[1].replace('get_', '').toLowerCase();
            console.log('\n🔍 File Key Request:');
            console.log(`Key: ${fileKey}`);
            console.log(`User ID: ${ctx.from.id}`);
            
            const isMember = await checkUserMembership(ctx);
            
            if (!isMember) {
                // ذخیره لینک برای کاربر
                pendingLinks.set(ctx.from.id, fileKey);
                console.log(`User is not a member. Link saved for user ${ctx.from.id}`);
                
                // Show join button
                await ctx.reply(
                    'برای دریافت فایل، لطفاً ابتدا در کانال ما عضو شوید.',
                    getSubscriptionKeyboard(ctx.from.id)
                );
                return;
            }
            
            // دریافت اطلاعات فایل از دیتابیس
            const fileData = await databaseService.getFileByKey(fileKey);
            console.log(`File Info: ${fileData ? JSON.stringify(fileData) : 'Not Found'}`);
            
            if (fileData) {
                let sentMessage;
                // ارسال پیام بر اساس نوع آن
                switch (fileData.type) {
                    case 'document':
                        sentMessage = await ctx.replyWithDocument(fileData.fileId);
                        break;
                    case 'photo':
                        sentMessage = await ctx.replyWithPhoto(fileData.fileId);
                        break;
                    case 'video':
                        sentMessage = await ctx.replyWithVideo(fileData.fileId);
                        break;
                    case 'audio':
                        sentMessage = await ctx.replyWithAudio(fileData.fileId);
                        break;
                    case 'text':
                        sentMessage = await ctx.reply(fileData.text);
                        break;
                    default:
                        await ctx.reply('⚠️ فایل پیدا نشد!');
                        return;
                }
                
                // به‌روزرسانی آمار دانلود
                await databaseService.incrementFileDownloads(fileKey);
                
                // ارسال پیام هشدار پس از ارسال فایل
                const warningMessage = await ctx.reply('⏱️ فایل ارسالی ربات به دلیل مسائل مشخص، بعد از ۳۰ ثانیه از ربات پاک می‌شوند. جهت دانلود فایل‌ را به پیام‌های ذخیره‌شده‌ی تلگرام یا چت دیگری فوروارد کنید.\n\n🤖 @ShioriUploadBot');
                
                // حذف فایل از چت پس از ۳۰ ثانیه
                setTimeout(async () => {
                    try {
                        // حذف پیام فایل
                        try {
                            await ctx.deleteMessage(sentMessage.message_id);
                            console.log(`Deleted file message ${sentMessage.message_id} after 30 seconds`);
                        } catch (fileError) {
                            if (fileError.description && fileError.description.includes('message to delete not found')) {
                                console.log(`File message ${sentMessage.message_id} already deleted`);
                            } else {
                                console.error(`Error deleting file message ${sentMessage.message_id}:`, fileError);
                            }
                        }
                        
                        // حذف پیام هشدار
                        try {
                            await ctx.deleteMessage(warningMessage.message_id);
                            console.log(`Deleted warning message ${warningMessage.message_id} after 30 seconds`);
                        } catch (warnError) {
                            if (warnError.description && warnError.description.includes('message to delete not found')) {
                                console.log(`Warning message ${warningMessage.message_id} already deleted`);
                            } else {
                                console.error(`Error deleting warning message ${warningMessage.message_id}:`, warnError);
                            }
                        }
                    } catch (error) {
                        console.error('General error in message deletion timeout:', error);
                    }
                }, 30000); // 30000 میلی‌ثانیه = 30 ثانیه
                
                console.log(`File sent to user ${ctx.from.id}`);
            } else {
                await ctx.reply('⚠️ فایل پیدا نشد یا منقضی شده است!');
            }
        } else {
            // پیام خوش‌آمدگویی به کاربر جدید
            await ctx.reply(`🤖 به ربات شیوری خوش آمدید.\n\n🔍 کانال ما: https://t.me/+vpEy9XrQjMw2N2E0`, { disable_web_page_preview: true });
        }
    } catch (error) {
        console.error('Error in start command handler:', error);
        await ctx.reply('⚠️ خطایی در پردازش درخواست شما رخ داد. لطفاً بعداً تلاش کنید.');
    }
});

// پردازش کلیک روی دکمه بررسی عضویت
bot.action(/^check_membership_(\d+)$/, async (ctx) => {
    try {
        const userId = ctx.match[1];
        const { isAllMember, memberships } = await membershipService.isMember(userId);
        
        if (isAllMember) {
            // حذف پیام قبلی
            await ctx.deleteMessage();
            
            // بررسی آیا کاربر لینک مستقیمی ارسال کرده بود
            const pendingLink = pendingLinks.get(userId);
            if (pendingLink) {
                // حذف لینک از لیست انتظار
                pendingLinks.delete(userId);
                
                // دریافت اطلاعات فایل از دیتابیس
                const fileData = await databaseService.getFileByKey(pendingLink);
                
                if (fileData) {
                    let sentMessage;
                    // ارسال پیام بر اساس نوع آن
                    switch (fileData.type) {
                        case 'document':
                            sentMessage = await ctx.replyWithDocument(fileData.fileId);
                            break;
                        case 'photo':
                            sentMessage = await ctx.replyWithPhoto(fileData.fileId);
                            break;
                        case 'video':
                            sentMessage = await ctx.replyWithVideo(fileData.fileId);
                            break;
                        case 'audio':
                            sentMessage = await ctx.replyWithAudio(fileData.fileId);
                            break;
                        case 'text':
                            sentMessage = await ctx.reply(fileData.text);
                            break;
                    }

                    // ارسال پیام هشدار
                    const warningMessage = await ctx.reply('⏱️ فایل ارسالی ربات به دلیل مسائل مشخص، بعد از ۳۰ ثانیه از ربات پاک می‌شوند. جهت دانلود فایل‌ را به پیام‌های ذخیره‌شده‌ی تلگرام یا چت دیگری فوروارد کنید.\n\n🤖 @ShioriUploadBot');

                    // حذف فایل بعد از ۳۰ ثانیه
                    setTimeout(async () => {
                        try {
                            await ctx.deleteMessage(sentMessage.message_id);
                            await ctx.deleteMessage(warningMessage.message_id);
                        } catch (error) {
                            console.error('Error deleting messages:', error);
                        }
                    }, 30000);
                    
                    // به‌روزرسانی آمار دانلود
                    await databaseService.incrementFileDownloads(pendingLink);
                } else {
                    await ctx.reply('❌ متأسفانه فایل مورد نظر منقضی شده است.');
                }
            } else {
                // اگر لینکی در انتظار نبود، پیام عادی نمایش داده شود
                await ctx.reply('✅ عضویت شما در کانال‌ها تأیید شد.\n\nبرای دریافت فایل، روی لینک مستقیم فایل مورد نظر کلیک کنید.');
            }
        } else {
            // ساخت پیام وضعیت عضویت
            let statusMessage = '📢 وضعیت عضویت شما:\n\n';
            for (const [channelUsername, status] of Object.entries(memberships)) {
                const emoji = status.isMember ? '✅' : '❌';
                statusMessage += `${emoji} ${status.name}\n`;
            }
            statusMessage += '\nبرای دریافت فایل، لطفاً در همه کانال‌ها عضو شوید.';

            await ctx.answerCbQuery('⚠️ هنوز در همه کانال‌ها عضو نیستید!', { show_alert: true, cache_time: 0 });
            await ctx.editMessageText(statusMessage, getSubscriptionKeyboard(ctx.from.id));
        }
    } catch (error) {
        console.error('Error handling check_membership action:', error);
        await ctx.answerCbQuery('⚠️ خطایی رخ داد. لطفاً دوباره تلاش کنید.', { show_alert: true, cache_time: 0 });
    }
});

// لاگ کردن تمام پیام‌های دریافتی
bot.on('message', async (ctx) => {
    console.log('\n📨 New Message Received:');
    console.log(`🆔 Chat ID: ${ctx.chat.id}`);
    console.log(`📝 Message Type: ${ctx.message ? ctx.message.text ? 'Text' : ctx.message.document ? 'File' : 'Other' : 'Unknown'}`);
    console.log('----------------------------------------');
});

bot.on('channel_post', async (ctx) => {
    try {
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
                console.log(`Size: ${formatFileSize(file.file_size)}`);
                console.log(`Type: ${file.mime_type}`);
            }
            
            console.log('----------------------------------------\n');
        }
    } catch (error) {
        console.error('❌ خطا در ثبت پست کانال:', error.message);
    }
});

// پردازش فایل‌های ارسال شده در کانال خصوصی
bot.on('document', async (ctx) => {
    try {
        const chatId = ctx.chat.id;
        const channelId = process.env.PRIVATE_CHANNEL_ID;
        
        // Check if the message is from the private channel
        if (chatId.toString() === channelId) {
            const file = ctx.message.document;
            const fileKey = generateFileKey();
            
            // Create direct link
            const botUsername = bot.botInfo?.username;
            const directLink = `https://t.me/${botUsername}?start=get_${fileKey}`;
            
            // ذخیره اطلاعات فایل در دیتابیس
            const fileData = {
                key: fileKey,
                messageId: ctx.message.message_id,
                type: 'document',
                fileId: file.file_id,
                fileName: file.file_name,
                fileSize: file.file_size,
                date: Date.now(),
                isActive: true,
                downloads: 0
            };
            
            await databaseService.createFile(fileData);
            
            // Log file information in English
            const logMessage = `📥 New File Received\n\n` +
                `File Name: ${file.file_name}\n` +
                `File Size: ${formatFileSize(file.file_size)}\n` +
                `File ID: ${file.file_id}\n` +
                `File Key: ${fileKey}\n` +
                `Direct Link: ${directLink}\n` +
                `Date: ${new Date().toLocaleString('en-US')}`;

            // Send log message to private channel
            await ctx.telegram.sendMessage(channelId, logMessage, {
                parse_mode: 'HTML'
            });

            // Add key and direct link to file caption
            const caption = ctx.message.caption || '';
            const newCaption = `${caption}\n\n🔑 Key: ${fileKey}\n🔗 Direct Link: ${directLink}`;
            
            try {
                await ctx.telegram.editMessageCaption(channelId, ctx.message.message_id, null, newCaption);
            } catch (error) {
                console.error('Error updating caption:', error.message);
            }
        }
    } catch (error) {
        console.error('Error processing file:', error.message);
    }
});

// Store previously seen message IDs
const channelMessages = new Map();

// Track channel messages
bot.on('channel_post', (ctx, next) => {
    const chatId = ctx.chat.id;
    const messageId = ctx.channelPost.message_id;
    
    if (chatId && messageId && chatId.toString() === config.PRIVATE_CHANNEL_ID.toString()) {
        if (!channelMessages.has(chatId)) {
            channelMessages.set(chatId, new Set());
        }
        channelMessages.get(chatId).add(messageId);
    }
    
    return next();
});

// Listen for message deletions in channels
// Note: This event is not officially documented in Telegraf but is supported in some cases
bot.on('message_delete', async (ctx) => {
    try {
        const chatId = ctx.chat.id;
        
        if (chatId && chatId.toString() === config.PRIVATE_CHANNEL_ID.toString()) {
            const messageIds = ctx.update?.message_delete?.message_ids || [];
            
            if (messageIds.length > 0) {
                console.log(`\n🗑️ Message deletion detected directly: ${messageIds.join(', ')}`);
                
                // Remove from tracking
                messageIds.forEach(id => {
                    markMessageDeleted(channelMessages, chatId, id);
                });
                
                // Process deletion in database
                await fileHandlerService.handleDeletedMessages({ chat: { id: chatId } }, messageIds);
            }
        }
    } catch (error) {
        console.error('Error handling direct message deletion:', error);
    }
});

// Telegram API doesn't provide deleted message events directly
// Check for deleted messages periodically (every 5 minutes)
setInterval(async () => {
    const chatId = config.PRIVATE_CHANNEL_ID;
    const messages = channelMessages.get(chatId);
    
    if (!messages || messages.size === 0) return;
    
    try {
        // Get recent messages (up to 100)
        const updates = await bot.telegram.getUpdates({ 
            offset: -1,
            limit: 100,
            allowed_updates: ['channel_post']
        });

        // Create a set of current message IDs
        const currentMessageIds = new Set();
        
        // Try to get channel messages directly
        try {
            const history = await bot.telegram.getChatHistory(chatId, { limit: 100 });
            if (history && history.messages) {
                history.messages.forEach(msg => {
                    if (msg.message_id) {
                        currentMessageIds.add(msg.message_id);
                    }
                });
            }
        } catch (err) {
            console.log('Could not get chat history, using update method');
            // Extract message IDs from updates if chat history not available
            updates.forEach(update => {
                if (update.channel_post && 
                    update.channel_post.chat && 
                    update.channel_post.chat.id.toString() === chatId.toString()) {
                    currentMessageIds.add(update.channel_post.message_id);
                }
            });
        }
        
        // Find deleted messages
        const deletedMessageIds = [];
        messages.forEach(messageId => {
            if (!currentMessageIds.has(messageId)) {
                deletedMessageIds.push(messageId);
            }
        });
        
        // Process deleted messages
        if (deletedMessageIds.length > 0) {
            console.log(`Detected ${deletedMessageIds.length} deleted messages`);
            
            // Remove deleted messages from tracking
            deletedMessageIds.forEach(id => {
                messages.delete(id);
            });
            
            // Create a manual update object and trigger the handler
            const ctx = {
                chat: { id: chatId },
                update: {
                    channel_post_deleted: {
                        message_ids: deletedMessageIds
                    }
                }
            };
            
            bot.handleUpdate(ctx);
        }
    } catch (error) {
        console.error('Error checking for deleted messages:', error);
    }
}, 5 * 60 * 1000); // Check every 5 minutes

// Setup all bot handlers
setupHandlers(bot);

// Handle errors
bot.catch((err, ctx) => {
    console.error(`Error handling update ${ctx.update.update_id}:`, err);
});

// Start the bot
bot.launch()
    .then(() => {
        console.log('✅ Bot started successfully');
        console.log(`🤖 Bot username: @${bot.botInfo.username}`);
    })
    .catch(err => {
        console.error('❌ Failed to start bot:', err);
        process.exit(1);
    });

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Create HTTPS agent with SSL verification disabled
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true,
    timeout: 60000
});

// Initialize webhook
const initializeWebhook = async () => {
    try {
        // Get the webhook URL from Render
        const webhookUrl = process.env.RENDER_EXTERNAL_URL 
            ? `${process.env.RENDER_EXTERNAL_URL}/webhook`
            : `https://${process.env.RENDER_SERVICE_NAME}.onrender.com/webhook`;
            
        console.log('🌐 Setting up webhook URL:', webhookUrl);
        
        // First, try to get current webhook info
        console.log('ℹ️ Getting current webhook info...');
        try {
            const currentWebhook = await bot.telegram.getWebhookInfo();
            console.log('Current webhook info:', currentWebhook);
        } catch (infoError) {
            console.error('⚠️ Error getting webhook info:', {
                message: infoError.message,
                description: infoError.description,
                code: infoError.code
            });
        }
        
        // Delete existing webhook
        console.log('🗑️ Deleting existing webhook...');
        try {
            await bot.telegram.deleteWebhook();
            console.log('✅ Successfully deleted existing webhook');
        } catch (deleteError) {
            console.error('⚠️ Error deleting webhook:', {
                message: deleteError.message,
                description: deleteError.description,
                code: deleteError.code
            });
        }
        
        // Set up the new webhook
        console.log('🔄 Setting up new webhook...');
        try {
            const result = await bot.telegram.setWebhook(webhookUrl, {
                agent: httpsAgent,
                max_connections: 40
            });
            console.log('✅ Webhook setup result:', result);
        } catch (setError) {
            console.error('❌ Error setting webhook:', {
                message: setError.message,
                description: setError.description,
                code: setError.code,
                response: setError.response?.data
            });
            throw setError;
        }
        
        // Verify webhook info
        console.log('🔍 Verifying webhook setup...');
        const webhookInfo = await bot.telegram.getWebhookInfo();
        console.log('ℹ️ Final webhook info:', webhookInfo);
        
        if (!webhookInfo.url || webhookInfo.url !== webhookUrl) {
            throw new Error('Webhook URL verification failed');
        }
        
        console.log('✅ Webhook setup completed successfully');
        return true;
    } catch (error) {
        console.error('❌ Failed to setup webhook:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            description: error.description,
            response: error.response?.data
        });
        return false;
    }
};

// Initialize webhook on first request
let webhookInitialized = false;

// Webhook endpoint
app.post('/webhook', async (req, res) => {
    try {
        // Log request details
        console.log('📥 Received webhook request:', {
            method: req.method,
            path: req.url,
            headers: req.headers,
            body: req.body
        });

        // Parse body if it's a string
        let update = req.body;
        if (typeof req.body === 'string') {
            try {
                update = JSON.parse(req.body);
            } catch (e) {
                console.error('❌ Failed to parse request body:', e);
                return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
            }
        }

        // Handle the update
        await bot.handleUpdate(update);
        res.json({ ok: true });
    } catch (error) {
        console.error('❌ Webhook error:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.get('/health', async (req, res) => {
    res.status(200).json({ ok: true, status: 'healthy' });
}); 
// Health check endpoint
app.get('/webhook', async (req, res) => {
    try {
        // Try to initialize webhook if not already initialized
        if (!webhookInitialized) {
            console.log('🔄 Initializing webhook for the first time...');
            const success = await initializeWebhook();
            webhookInitialized = success;
            console.log('✅ Webhook initialization completed:', success);
        }

        return res.status(200).json({
            ok: true,
            status: 'healthy',
            timestamp: new Date().toISOString(),
            webhook: webhookInitialized ? 'active' : 'inactive',
            path: req.url,
            webhookInitialized
        });
    } catch (error) {
        console.error('❌ Health check error:', error);
        res.status(500).json({
            ok: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    console.log('🌐 Webhook URL:', process.env.RENDER_EXTERNAL_URL 
        ? `${process.env.RENDER_EXTERNAL_URL}/webhook`
        : `https://${process.env.RENDER_SERVICE_NAME}.onrender.com/webhook`);
});
