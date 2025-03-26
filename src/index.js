require('dotenv').config();
const { Telegraf } = require('telegraf');
const handleFile = require('./handlers/fileHandler');
const handleStart = require('./handlers/startHandler');
const logService = require('./services/logService');

// Disable SSL verification for development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const bot = new Telegraf(process.env.BOT_TOKEN);

// ذخیره‌سازی فایل‌ها و کلیدهای آنها
const fileKeys = new Map();
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

// تولید کلید تصادفی
function generateFileKey() {
    const key = Math.floor(100000000 + Math.random() * 900000000).toString();
    console.log(`Generated Key: ${key}`);
    return key;
}

// ایجاد دکمه‌های شیشه‌ای
const getSubscriptionKeyboard = () => {
    return {
        inline_keyboard: [
            [{ text: '📢 عضویت در کانال', url: `https://t.me/${process.env.PUBLIC_CHANNEL_USERNAME}` }],
            [{ text: '✅ بررسی عضویت', callback_data: 'check_membership' }]
        ]
    };
};

// بررسی عضویت کاربر در کانال عمومی
async function checkUserMembership(ctx) {
    try {
        const member = await ctx.telegram.getChatMember(process.env.PUBLIC_CHANNEL_ID, ctx.from.id);
        return ['member', 'administrator', 'creator'].includes(member.status);
    } catch (error) {
        console.error('Error checking membership:', error);
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery('⚠️ خطا در بررسی عضویت', { show_alert: true, cache_time: 0 });
        }
        return false;
    }
}

// ارسال پیام عدم عضویت با دکمه‌های شیشه‌ای
async function sendNotMemberMessage(ctx) {
    try {
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery('⚠️ هنوز توی بعضی از کانال‌ها عضو نشدی! لطفاً توی همه عضو شو، بعد دکمه رو بزن.', { show_alert: true, cache_time: 0 });
            await ctx.editMessageText('📢 برای عضویت در کانال، روی دکمه زیر کلیک کنید:', getSubscriptionKeyboard());
        } else {
            await ctx.reply('📢 برای عضویت در کانال، روی دکمه زیر کلیک کنید:', getSubscriptionKeyboard());
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
async function handleChannelPost(ctx) {
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
            const botUsername = ctx.botInfo?.username;
            const directLink = `https://t.me/${botUsername}?start=get_${fileKey}`;
            
            // Store message information
            let messageInfo = {
                messageId: message.message_id,
                type: 'text',
                date: Date.now()
            };

            // Handle different message types
            if (message.document) {
                messageInfo.type = 'document';
                messageInfo.fileId = message.document.file_id;
                messageInfo.fileName = message.document.file_name;
                messageInfo.fileSize = message.document.file_size;
                console.log(`Document Info: ${messageInfo.fileName} (${formatFileSize(messageInfo.fileSize)})`);
            } else if (message.photo) {
                messageInfo.type = 'photo';
                messageInfo.fileId = message.photo[message.photo.length - 1].file_id;
                console.log('Photo Message');
            } else if (message.video) {
                messageInfo.type = 'video';
                messageInfo.fileId = message.video.file_id;
                console.log('Video Message');
            } else if (message.audio) {
                messageInfo.type = 'audio';
                messageInfo.fileId = message.audio.file_id;
                console.log('Audio Message');
            }

            // Store the message info
            fileKeys.set(fileKey, messageInfo);
            
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
}

// پردازش دستور /start
async function handleStart(ctx) {
    try {
        const args = ctx.message.text.split(' ');
        // بررسی آیا لینک دریافت فایل است
        if (args.length > 1 && args[1].startsWith('get_')) {
            const fileKey = args[1].replace('get_', '').toLowerCase();
            console.log('\n🔍 File Key Request:');
            console.log(`Key: ${fileKey}`);
            console.log(`User ID: ${ctx.from.id}`);
            console.log(`Available Keys: ${Array.from(fileKeys.keys()).join(', ')}`);
            
            const isMember = await checkUserMembership(ctx);
            
            if (!isMember) {
                // ذخیره لینک برای کاربر
                pendingLinks.set(ctx.from.id, fileKey);
                console.log(`User is not a member. Link saved for user ${ctx.from.id}`);
                await sendNotMemberMessage(ctx);
                return;
            }
            
            const messageInfo = fileKeys.get(fileKey);
            console.log(`Message Info: ${messageInfo ? JSON.stringify(messageInfo) : 'Not Found'}`);
            
            if (messageInfo) {
                let sentMessage;
                // ارسال پیام بر اساس نوع آن
                switch (messageInfo.type) {
                    case 'document':
                        sentMessage = await ctx.replyWithDocument(messageInfo.fileId);
                        break;
                    case 'photo':
                        sentMessage = await ctx.replyWithPhoto(messageInfo.fileId);
                        break;
                    case 'video':
                        sentMessage = await ctx.replyWithVideo(messageInfo.fileId);
                        break;
                    case 'audio':
                        sentMessage = await ctx.replyWithAudio(messageInfo.fileId);
                        break;
                    case 'text':
                        sentMessage = await ctx.reply(messageInfo.text);
                        break;
                }

                // ارسال پیام هشدار
                await ctx.reply('⚠️ فایل ارسال‌شده به دلایل مشخص پس از یک دقیقه حذف می‌شود. لطفاً جهت دریافت فایل آن را به پیام‌های ذخیره‌شده یا پیام خصوصی دوستان خود فوروارد کنید.');

                // حذف فایل بعد از 1 دقیقه
                setTimeout(async () => {
                    try {
                        await ctx.telegram.deleteMessage(ctx.chat.id, sentMessage.message_id);
                    } catch (error) {
                        console.error('Error deleting message:', error);
                    }
                }, 60000); // 1 minute

                return;
            } else {
                console.log('❌ Invalid or expired file key');
                await ctx.reply('❌ کلید پیام نامعتبر است یا منقضی شده است.');
                return;
            }
        }

        // اگر لینک دریافت فایل نبود، پیام خوش‌آمدگویی نمایش داده شود
        const isMember = await checkUserMembership(ctx);
        if (isMember) {
            await ctx.reply('👋 به ربات شیوری خوش آمدید\n\nآدرس کانال: https://t.me/+x5guW0j8thxlMTQ0', { disable_web_page_preview: true });
        } else {
            const welcomeMessage = '👋 به ربات ما خوش آمدید!\n📢 برای عضویت در کانال، روی دکمه زیر کلیک کنید:';
            await ctx.reply(welcomeMessage, getSubscriptionKeyboard());
        }
    } catch (error) {
        console.error('Error handling start command:', error);
        await ctx.reply('⚠️ خطایی رخ داد. لطفاً دوباره تلاش کنید.');
    }
}

// پردازش کلیک روی دکمه بررسی عضویت
async function handleCheckMembership(ctx) {
    try {
        const isMember = await checkUserMembership(ctx);
        if (isMember) {
            // حذف پیام قبلی
            await ctx.deleteMessage();
            
            // بررسی آیا کاربر لینک مستقیمی ارسال کرده بود
            const pendingLink = pendingLinks.get(ctx.from.id);
            if (pendingLink) {
                // حذف لینک از لیست انتظار
                pendingLinks.delete(ctx.from.id);
                
                // ارسال فایل مربوطه
                const messageInfo = fileKeys.get(pendingLink);
                if (messageInfo) {
                    let sentMessage;
                    // ارسال پیام بر اساس نوع آن
                    switch (messageInfo.type) {
                        case 'document':
                            sentMessage = await ctx.replyWithDocument(messageInfo.fileId);
                            break;
                        case 'photo':
                            sentMessage = await ctx.replyWithPhoto(messageInfo.fileId);
                            break;
                        case 'video':
                            sentMessage = await ctx.replyWithVideo(messageInfo.fileId);
                            break;
                        case 'audio':
                            sentMessage = await ctx.replyWithAudio(messageInfo.fileId);
                            break;
                        case 'text':
                            sentMessage = await ctx.reply(messageInfo.text);
                            break;
                    }

                    // ارسال پیام هشدار
                    await ctx.reply('⚠️ فایل ارسال‌شده به دلایل مشخص پس از یک دقیقه حذف می‌شود. لطفاً جهت دریافت فایل آن را به پیام‌های ذخیره‌شده یا پیام خصوصی دوستان خود فوروارد کنید.');

                    // حذف فایل بعد از 1 دقیقه
                    setTimeout(async () => {
                        try {
                            await ctx.telegram.deleteMessage(ctx.chat.id, sentMessage.message_id);
                        } catch (error) {
                            console.error('Error deleting message:', error);
                        }
                    }, 60000); // 1 minute
                } else {
                    await ctx.reply('❌ متأسفانه فایل مورد نظر منقضی شده است.');
                }
            } else {
                // اگر لینکی در انتظار نبود، پیام عادی نمایش داده شود
                await ctx.reply('✅ عضویت شما در کانال تأیید شد.\n\nبرای دریافت فایل، روی لینک مستقیم فایل مورد نظر کلیک کنید.');
            }
        } else {
            await ctx.answerCbQuery('⚠️ هنوز توی بعضی از کانال‌ها عضو نشدی! لطفاً توی همه عضو شو، بعد دکمه رو بزن.', { show_alert: true, cache_time: 0 });
            try {
                await ctx.editMessageText('📢 برای عضویت در کانال، روی دکمه زیر کلیک کنید:', {
                    ...getSubscriptionKeyboard(),
                    chat_id: ctx.chat.id,
                    message_id: ctx.callbackQuery.message.message_id
                });
            } catch (error) {
                if (!error.message.includes('message is not modified')) {
                    console.error('Error editing message:', error);
                }
            }
        }
    } catch (error) {
        console.error('Error handling check_membership action:', error);
        await ctx.answerCbQuery('⚠️ خطایی رخ داد. لطفاً دوباره تلاش کنید.', { show_alert: true, cache_time: 0 });
    }
}

// تنظیم هندلرها
bot.command('start', handleStart);
bot.action('check_membership', handleCheckMembership);
bot.on('channel_post', handleChannelPost);

// هندلر اصلی برای Cloudflare Workers
export default {
    async fetch(request, env, ctx) {
        try {
            const url = new URL(request.url);
            if (url.pathname === '/webhook') {
                if (request.method === 'POST') {
                    const update = await request.json();
                    await bot.handleUpdate(update);
                    return new Response('OK', { status: 200 });
                }
                return new Response('Method not allowed', { status: 405 });
            }
            return new Response('Not found', { status: 404 });
        } catch (error) {
            console.error('Error handling request:', error);
            return new Response('Internal server error', { status: 500 });
        }
    }
}; 