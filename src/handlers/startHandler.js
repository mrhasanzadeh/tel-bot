const fileService = require('../services/fileService');
const membershipService = require('../services/membershipService');

const handleStart = async (ctx) => {
    try {
        const userId = ctx.from.id;
        const username = ctx.from.username;
        const startPayload = ctx.message.text.split(' ')[1];
        
        // Check if user is a member
        const isMember = await membershipService.isMember(userId);
        
        if (!isMember) {
            // If user is not a member, show join button
            const joinButton = {
                inline_keyboard: [[
                    { text: '👥 عضویت در کانال', url: `https://t.me/${process.env.PUBLIC_CHANNEL_USERNAME}` },
                    { text: '✅ بررسی عضویت', callback_data: `check_membership_${userId}` }
                ]]
            };

            await ctx.reply(
                'برای دریافت فایل، لطفاً ابتدا در کانال ما عضو شوید.',
                { reply_markup: joinButton }
            );
            return;
        }

        if (startPayload && startPayload.startsWith('get_')) {
            const fileKey = startPayload.replace('get_', '');
            console.log(`🔍 Looking for file with key: ${fileKey}`);
            
            try {
                const fileInfo = await fileService.getFileByKey(fileKey);
                
                if (fileInfo) {
                    console.log(`📤 Sending file: ${fileInfo.fileName}`);
                    // Forward file from private channel to user
                    await ctx.telegram.copyMessage(
                        ctx.chat.id,
                        process.env.PRIVATE_CHANNEL_ID,
                        fileInfo.messageId
                    );
                    
                    await ctx.reply('✅ فایل با موفقیت ارسال شد!');
                } else {
                    console.log(`❌ File not found: ${fileKey}`);
                    await ctx.reply('❌ فایل مورد نظر یافت نشد یا حذف شده است.');
                }
            } catch (fileError) {
                console.error('Error getting file:', fileError);
                await ctx.reply('❌ خطا در دریافت فایل. لطفاً دوباره تلاش کنید.');
            }
        } else {
            await ctx.reply(
                `سلام ${username || 'کاربر'} عزیز! 👋\n\n` +
                'به ربات دانلود فایل خوش آمدید. برای دریافت فایل مورد نظر، لطفاً لینک آن را ارسال کنید.'
            );
        }
    } catch (error) {
        console.error('Error in start handler:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            code: error.code
        });
        await ctx.reply('متأسفانه خطایی رخ داد. لطفاً دوباره تلاش کنید.');
    }
};

module.exports = handleStart; 