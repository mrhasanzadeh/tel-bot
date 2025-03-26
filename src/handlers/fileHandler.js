const fileService = require('../services/fileService');
const logService = require('../services/logService');

const checkBotAccess = async (ctx, channelId) => {
    try {
        const chat = await ctx.telegram.getChat(channelId);
        const botMember = await ctx.telegram.getChatMember(channelId, ctx.botInfo.id);
        
        console.log('Channel Info:', {
            id: chat.id,
            title: chat.title,
            type: chat.type
        });
        
        console.log('Bot Access:', {
            status: botMember.status,
            canPostMessages: botMember.can_post_messages,
            canEditMessages: botMember.can_edit_messages
        });

        return botMember.status === 'administrator';
    } catch (error) {
        console.error('Error checking bot access:', error.message);
        return false;
    }
};

const handleFile = async (ctx) => {
    try {
        const chatId = ctx.chat.id;
        const channelId = process.env.PRIVATE_CHANNEL_ID;
        
        // Log all channel messages
        await logService.logChannelMessage(ctx);
        
        // Check if the message is from the private channel
        if (chatId.toString() === channelId) {
            console.log('✅ Message is from private channel');
            
            // Check bot access first
            const hasAccess = await checkBotAccess(ctx, channelId);
            if (!hasAccess) {
                console.error('❌ Bot does not have required access to the private channel');
                return;
            }

            // Check if the message contains a document
            if (ctx.channelPost && ctx.channelPost.document) {
                const file = ctx.channelPost.document;
                console.log('📎 Processing file:', {
                    fileName: file.file_name,
                    fileSize: file.file_size,
                    fileId: file.file_id
                });

                const fileKey = await fileService.handleNewFile(ctx, file);
                
                console.log(`✅ File processed successfully!`);
                console.log(`🔑 Generated Key: ${fileKey}`);
                console.log('----------------------------------------\n');
            }
        } else {
            console.log('❌ Message is not from private channel');
        }
    } catch (error) {
        console.error('❌ Error in file handler:', error.message);
    }
};

module.exports = handleFile; 