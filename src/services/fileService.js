const { generateFileKey } = require('../utils/logger');

class FileService {
    constructor() {
        this.fileKeys = new Map();
    }

    async handleNewFile(ctx, file) {
        try {
            const fileKey = generateFileKey();
            
            // Store file information
            this.fileKeys.set(fileKey, {
                fileId: file.file_id,
                name: file.file_name,
                size: file.file_size,
                date: Date.now(),
                messageId: ctx.channelPost.message_id
            });

            // Create direct link
            const directLink = `https://t.me/${ctx.botInfo.username}?start=get_${fileKey}`;
            
            // Add key and link to file caption
            const caption = ctx.channelPost.caption || '';
            const newCaption = `${caption}\n\n🔑 Key: ${fileKey}\n📱 Direct Link: ${directLink}`;
            
            try {
                await ctx.telegram.editMessageCaption(ctx.chat.id, ctx.channelPost.message_id, null, newCaption);
                console.log('✅ Caption updated successfully');
            } catch (error) {
                console.error('Error updating caption:', error.message);
            }

            return fileKey;
        } catch (error) {
            console.error('Error handling file:', error.message);
            throw error;
        }
    }

    getFileByKey(key) {
        return this.fileKeys.get(key);
    }

    getAllFiles() {
        return Array.from(this.fileKeys.entries());
    }
}

module.exports = new FileService(); 