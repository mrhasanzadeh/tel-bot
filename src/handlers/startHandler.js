const fileService = require('../services/fileService');

const handleStart = async (ctx) => {
    try {
        const startPayload = ctx.message.text.split(' ')[1];
        
        if (startPayload && startPayload.startsWith('get_')) {
            const fileKey = startPayload.replace('get_', '');
            const fileInfo = fileService.getFileByKey(fileKey);
            
            if (fileInfo) {
                // Forward file from private channel to user
                await ctx.telegram.copyMessage(
                    ctx.chat.id,
                    process.env.PRIVATE_CHANNEL_ID,
                    fileInfo.messageId
                );
                
                await ctx.reply('✅ File sent successfully!');
            } else {
                await ctx.reply('❌ File not found or has been removed.');
            }
        } else {
            await ctx.reply('👋 Welcome! Please use the direct link to get files.');
        }
    } catch (error) {
        console.error('Error in start handler:', error.message);
        await ctx.reply('❌ Error processing your request. Please try again.');
    }
};

module.exports = handleStart; 