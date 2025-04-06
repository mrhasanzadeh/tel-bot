const config = require('../../config');
const databaseService = require('./databaseService');
const { generateFileKey, delay, formatFileSize } = require('../utils/fileUtils');

/**
 * Service for handling file operations
 * @class FileHandlerService
 */
class FileHandlerService {
    /**
     * Create a new file handler service instance
     */
    constructor() {
        if (FileHandlerService.instance) {
            return FileHandlerService.instance;
        }
        FileHandlerService.instance = this;
    }

    /**
     * Handle a new file in the private channel
     * @param {Object} ctx - Telegram context
     * @returns {Promise<void>}
     */
    async handleNewFile(ctx) {
        try {
            console.log('📨 Processing new file...');
            const message = ctx.channelPost;
            const file = message.document || message.video || message.audio;
            
            if (!file) {
                console.log('❌ No file found in message');
                return;
            }

            const fileKey = generateFileKey();
            console.log(`🔑 Generated file key: ${fileKey}`);

            // Create direct link
            const botUsername = ctx.botInfo?.username;
            const directLink = `https://t.me/${botUsername}?start=get_${fileKey}`;
            
            // Store file information
            const fileData = this._extractFileData(message, fileKey);
            await databaseService.createFile(fileData);
            console.log(`✅ File saved to database with key: ${fileKey}`);

            // Update message caption or send new message
            await this._updateMessageCaption(ctx, message, fileKey, directLink, ctx.chat.id);
        } catch (error) {
            console.error('❌ Error handling new file:', error);
            throw error;
        }
    }

    /**
     * Process a post from the private channel
     * @param {Object} ctx - Telegram context
     * @returns {Promise<void>}
     */
    async processChannelPost(ctx) {
        try {
            console.log('📨 Processing channel post...');
            const chatId = ctx.chat.id;
            const channelId = config.PRIVATE_CHANNEL_ID;
            
            if (chatId.toString() !== channelId.toString()) {
                console.log('❌ Not a private channel post, skipping');
                return;
            }
            
            const message = ctx.channelPost;
            const file = message.document || message.video || message.audio;
            
            if (!file) {
                console.log('❌ No file found in message');
                return;
            }
            
            const fileKey = generateFileKey();
            console.log(`🔑 Generated file key: ${fileKey}`);
            
            // Create direct link
            const botUsername = ctx.botInfo?.username;
            const directLink = `https://t.me/${botUsername}?start=get_${fileKey}`;
            
            // Store file information
            const fileData = this._extractFileData(message, fileKey);
            await databaseService.createFile(fileData);
            console.log(`✅ File saved to database with key: ${fileKey}`);

            // Update message caption or send new message
            await this._updateMessageCaption(ctx, message, fileKey, directLink, channelId);
        } catch (error) {
            console.error('❌ Error processing channel post:', error);
            throw error;
        }
    }

    /**
     * Handle a file request
     * @param {Object} ctx - Telegram context
     * @param {string} fileKey - The file key
     * @returns {Promise<void>}
     */
    async handleFileRequest(ctx, fileKey = null) {
        try {
            console.log('📥 Handling file request:', { fileKey, ctx: ctx.message });
            
            // If no fileKey provided, try to extract from message text
            if (!fileKey && ctx.message && ctx.message.text) {
                fileKey = ctx.message.text.trim();
            }
            
            if (!fileKey) {
                console.log('❌ No file key provided');
                await ctx.reply('لطفاً کلید فایل را وارد کنید.');
                return;
            }
            
            // Find file in database
            const file = await databaseService.findFileByKey(fileKey);
            if (!file) {
                console.log('❌ File not found:', fileKey);
                await ctx.reply('فایل مورد نظر یافت نشد.');
                return;
            }
            
            // Send file to user
            console.log('✅ Sending file to user:', file);
            await this.sendFileToUser(ctx, file);
        } catch (error) {
            console.error('❌ Error handling file request:', error);
            await ctx.reply('متأسفانه خطایی رخ داد. لطفاً دوباره تلاش کنید.');
        }
    }

    /**
     * Send a file to user based on file key
     * @param {Object} ctx - Telegram context
     * @param {Object} file - The file data
     * @returns {Promise<boolean>} Whether file was sent successfully
     */
    async sendFileToUser(ctx, file) {
        try {
            console.log('📤 Sending file to user:', file);
            
            // Forward the file without caption
            const forwardedMessage = await ctx.telegram.copyMessage(
                ctx.chat.id,
                process.env.PRIVATE_CHANNEL_ID,
                file.messageId,
                { caption: '' }
            );
            
            // Send warning message
            const warningMessage = await ctx.reply(
                '⚠️ این پیام و فایل بعد از 30 ثانیه حذف خواهند شد.'
            );
            
            // Delete both messages after 30 seconds
            setTimeout(async () => {
                try {
                    await ctx.telegram.deleteMessage(ctx.chat.id, forwardedMessage.message_id);
                    await ctx.telegram.deleteMessage(ctx.chat.id, warningMessage.message_id);
                    console.log('✅ Messages deleted successfully');
                } catch (deleteError) {
                    console.error('❌ Error deleting messages:', deleteError);
                }
            }, 30000);
            
            console.log('✅ File sent successfully');
            return true;
        } catch (error) {
            console.error('❌ Error sending file:', error);
            throw error;
        }
    }

    /**
     * Extract file data from message
     * @private
     * @param {Object} message - Telegram message
     * @param {string} fileKey - Generated file key
     * @returns {Object} File data
     */
    _extractFileData(message, fileKey) {
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

        return fileData;
    }

    /**
     * Update message caption with file key and direct link
     * @private
     * @param {Object} ctx - Telegram context
     * @param {Object} message - Telegram message
     * @param {string} fileKey - Generated file key
     * @param {string} directLink - Direct link to file
     * @param {string} channelId - Channel ID
     * @returns {Promise<void>}
     */
    async _updateMessageCaption(ctx, message, fileKey, directLink, channelId) {
        try {
            console.log('🔄 Attempting to update message caption...');
            
            // Check if bot is admin and can edit messages
            const chatMember = await ctx.telegram.getChatMember(channelId, ctx.botInfo.id);
            const isAdmin = chatMember.status === 'administrator';
            const canEditMessages = chatMember.can_edit_messages;
            
            console.log(`Bot admin status: ${isAdmin}, Can edit messages: ${canEditMessages}`);

            if (isAdmin && canEditMessages) {
                try {
                    const caption = message.caption || '';
                    const newCaption = `${caption}\n\n🔑 Key: ${fileKey}\n🔗 Direct Link: ${directLink}`;
                    await ctx.telegram.editMessageCaption(channelId, message.message_id, null, newCaption);
                    console.log(`✅ Successfully updated caption for message ${message.message_id}`);
                } catch (error) {
                    console.error('❌ Error editing caption:', error);
                    // Fallback to sending new message
                    await this._sendFileInfoMessage(ctx, message, fileKey, directLink, channelId);
                }
            } else {
                await this._sendFileInfoMessage(ctx, message, fileKey, directLink, channelId);
            }
        } catch (error) {
            console.error('❌ Error in _updateMessageCaption:', error);
            // Last resort: try to send a new message
            try {
                await this._sendFileInfoMessage(ctx, message, fileKey, directLink, channelId);
            } catch (fallbackError) {
                console.error('❌ Error in fallback message sending:', fallbackError);
            }
        }
    }

    /**
     * Send file information in a new message
     * @private
     * @param {Object} ctx - Telegram context
     * @param {Object} message - Original message
     * @param {string} fileKey - File key
     * @param {string} directLink - Direct link
     * @param {string} channelId - Channel ID
     * @returns {Promise<void>}
     */
    async _sendFileInfoMessage(ctx, message, fileKey, directLink, channelId) {
        try {
            const infoMessage = `🔑 Key: ${fileKey}\n🔗 Direct Link: ${directLink}`;
            await ctx.telegram.sendMessage(channelId, infoMessage, {
                reply_to_message_id: message.message_id
            });
            console.log('✅ Sent file information in a new message');
        } catch (error) {
            console.error('❌ Error sending file info message:', error);
            throw error;
        }
    }

    /**
     * Handle deleted messages from the private channel
     * @param {Object} ctx - Telegram context
     * @param {Array<number>} messageIds - IDs of deleted messages
     * @returns {Promise<void>}
     */
    async handleDeletedMessages(ctx, messageIds) {
        try {
            console.log(`🗑️ Processing ${messageIds.length} deleted messages`);
            for (const messageId of messageIds) {
                await databaseService.deactivateFilesByMessageId(messageId);
            }
            console.log('✅ Successfully processed deleted messages');
        } catch (error) {
            console.error('❌ Error handling deleted messages:', error);
            throw error;
        }
    }
}

// Create and export a single instance of the service
const fileHandlerService = new FileHandlerService();
module.exports = fileHandlerService; 