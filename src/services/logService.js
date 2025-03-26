class LogService {
    async logChannelMessage(ctx) {
        try {
            const chatId = ctx.chat.id;
            const channelId = process.env.PRIVATE_CHANNEL_ID;
            
            if (chatId.toString() === channelId) {
                console.log('\n📨 New Channel Message:');
                console.log('----------------------------------------');
                console.log(`Channel ID: ${chatId}`);
                console.log(`Message ID: ${ctx.message.message_id}`);
                console.log(`Date: ${new Date().toLocaleString('en-US')}`);
                
                if (ctx.message.document) {
                    const file = ctx.message.document;
                    console.log('\n📎 File Information:');
                    console.log(`Name: ${file.file_name}`);
                    console.log(`Size: ${(file.file_size / 1024 / 1024).toFixed(2)} MB`);
                    console.log(`Type: ${file.mime_type}`);
                }
                
                console.log('----------------------------------------\n');
            }
        } catch (error) {
            console.error('Error logging channel message:', error.message);
        }
    }
}

module.exports = new LogService(); 