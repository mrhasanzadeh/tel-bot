const fileService = require('../services/fileService');
const membershipService = require('../services/membershipService');
const { e, inlineButton } = require('../utils/premiumEmoji');
const botReply = require('../utils/botReply');

function createJoinButtons(userId) {
    return {
        inline_keyboard: [[
            inlineButton({
                text: 'عضویت در کانال',
                emojiKey: 'users',
                url: `https://t.me/${process.env.PUBLIC_CHANNEL_USERNAME}`
            }),
            inlineButton({
                text: 'بررسی عضویت',
                emojiKey: 'success',
                callback_data: `check_membership_${userId}`
            })
        ]]
    };
}

const handleStart = async (ctx) => {
    try {
        const userId = ctx.from.id;
        const startPayload = ctx.message.text.split(' ')[1];

        const isMember = await membershipService.isMember(userId);
        console.log(`👤 User ${userId} membership status: ${isMember}`);

        if (startPayload && startPayload.startsWith('get_')) {
            const fileKey = startPayload.replace('get_', '');
            console.log(`🔍 Looking for file with key: ${fileKey}`);

            if (isMember) {
                try {
                    const fileInfo = await fileService.getFileByKey(fileKey);

                    if (fileInfo) {
                        console.log(`📤 Sending file: ${fileInfo.fileName}`);
                        await ctx.telegram.copyMessage(
                            ctx.chat.id,
                            process.env.PRIVATE_CHANNEL_ID,
                            fileInfo.messageId
                        );

                        await botReply.reply(ctx, `${e('success')} فایل با موفقیت ارسال شد!`);
                    } else {
                        console.log(`❌ File not found: ${fileKey}`);
                        await botReply.reply(ctx, `${e('error')} فایل مورد نظر یافت نشد یا حذف شده است.`);
                    }
                } catch (fileError) {
                    console.error('Error getting file:', fileError);
                    await botReply.reply(ctx, `${e('error')} خطا در دریافت فایل. لطفاً دوباره تلاش کنید.`);
                }
            } else {
                const pendingLinks = require('./botHandlers').pendingLinks;
                pendingLinks.set(userId, fileKey);
                console.log(`📝 Stored pending file request for user ${userId}`);

                await botReply.reply(
                    ctx,
                    'برای دریافت فایل، لطفاً ابتدا در کانال ما عضو شوید.',
                    { reply_markup: createJoinButtons(userId) }
                );
            }
        } else {
            if (isMember) {
                await botReply.reply(
                    ctx,
                    `${e('bot')} به ربات شیوری خوش آمدید.\n\n${e('search')} کانال ما: https://t.me/+vpEy9XrQjMw2N2E0`,
                    { disable_web_page_preview: true }
                );
            } else {
                await botReply.reply(
                    ctx,
                    'برای دریافت فایل، لطفاً ابتدا در کانال ما عضو شوید.',
                    { reply_markup: createJoinButtons(userId) }
                );
            }
        }
    } catch (error) {
        console.error('Error in start handler:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            code: error.code
        });
        await botReply.reply(ctx, 'متأسفانه خطایی رخ داد. لطفاً دوباره تلاش کنید.');
    }
};

module.exports = handleStart;
