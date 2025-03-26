const config = require('../../config');
const databaseService = require('./databaseService');
const { generateFileKey, delay, formatFileSize } = require('../utils/fileUtils');
const { pendingLinks } = require('../handlers/botHandlers');

/**
 * Service for handling file operations
 * @class FileHandlerService
 */
class FileHandlerService {
    /**
     * Process a post from the private channel
     * @param {Object} ctx - Telegram context
     * @returns {Promise<void>}
     */
    async processChannelPost(ctx) {
        try {
            const chatId = ctx.chat.id;
            const channelId = config.PRIVATE_CHANNEL_ID;
            
            if (chatId.toString() !== channelId.toString()) {
                return;
            }
            
            const message = ctx.channelPost;
            const file = message.document || message.video || message.audio;
            
            if (!file) {
                console.log('No file found in message');
                return;
            }
            
            const fileKey = generateFileKey();
            
            console.log('\n📨 Processing New Channel Post:');
            console.log(`Message ID: ${message.message_id}`);
            console.log(`Generated Key: ${fileKey}`);
            
            // Create direct link
            const botUsername = ctx.botInfo?.username;
            const directLink = `https://t.me/${botUsername}?start=get_${fileKey}`;
            
            // Store message information
            let fileData = this._extractFileData(message, fileKey);

            // Store file in database
            await databaseService.createFile(fileData);
            console.log(`Stored Message Info for Key: ${fileKey}`);

            // Update message caption with links
            await this._updateMessageCaption(ctx, message, fileKey, directLink, channelId);
        } catch (error) {
            console.error('Error processing channel post:', error);
        }
    }

    /**
     * Send a file to user based on file key
     * @param {Object} ctx - Telegram context
     * @param {string} fileKey - The file key
     * @returns {Promise<boolean>} Whether file was sent successfully
     */
    async sendFileToUser(ctx, fileKey) {
        try {
            // Get file data from database
            const fileData = await databaseService.getFileByKey(fileKey);
            console.log(`File Info: ${fileData ? JSON.stringify(fileData) : 'Not Found'}`);
            
            if (!fileData) {
                await ctx.reply('⚠️ File not found! Please check the code.');
                return false;
            }
            
            if (!fileData.isActive) {
                await ctx.reply('❌ این فایل دیگر در دسترس نیست.');
                return false;
            }
            
            await ctx.reply('📤 در حال ارسال فایل...');
            await ctx.telegram.copyMessage(ctx.chat.id, config.PRIVATE_CHANNEL_ID, fileData.messageId);
            
            // Update download statistics
            await databaseService.incrementFileDownloads(fileKey);
            console.log(`✅ File sent to user: ${ctx.from.id}`);
            return true;
        } catch (error) {
            console.error('Error sending file to user:', error);
            await ctx.reply('⚠️ خطا در ارسال فایل. لطفاً دوباره تلاش کنید.');
            return false;
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
            // Send new message with link
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

    /**
     * Handle deleted messages from the private channel
     * @param {Object} ctx - Telegram context
     * @param {Array<number>} messageIds - IDs of deleted messages
     * @returns {Promise<void>}
     */
    async handleDeletedMessages(ctx, messageIds) {
        try {
            const chatId = ctx.chat.id;
            const channelId = config.PRIVATE_CHANNEL_ID;
            
            if (chatId.toString() !== channelId.toString()) {
                return;
            }
            
            console.log('\n🗑️ Processing Deleted Messages:');
            console.log(`Channel ID: ${chatId}`);
            console.log(`Message IDs: ${messageIds.join(', ')}`);
            
            // Deactivate files associated with deleted messages
            for (const messageId of messageIds) {
                const deactivatedFiles = await databaseService.deactivateFilesByMessageId(messageId);
                if (deactivatedFiles > 0) {
                    console.log(`✅ Deactivated ${deactivatedFiles} files for message ID: ${messageId}`);
                } else {
                    console.log(`ℹ️ No active files found for message ID: ${messageId}`);
                }
            }
        } catch (error) {
            console.error('Error handling deleted messages:', error);
        }
    }
}

module.exports = new FileHandlerService(); 