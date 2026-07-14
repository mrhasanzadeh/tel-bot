const config = require('../../config');
const databaseService = require('./databaseService');
const { getPrivateChannelId, getArchiveChannelId } = require('../utils/channelIds');
const { generateFileKey, delay, delayCancellable, formatFileSize, extractFileKeyFromCaption } = require('../utils/fileUtils');
const { e, escapeHtml, inlineButton } = require('../utils/premiumEmoji');
const botReply = require('../utils/botReply');
const scheduleService = require('./scheduleService');

/** After pack send finishes, keep files this long (ms). Override: PACK_FILE_DELETE_MS in .env */
const PACK_FILE_DELETE_MS = config.PACK_FILE_DELETE_MS;

function formatPackDeleteDelayFa(ms) {
    const seconds = Math.round(ms / 1000);
    if (seconds >= 60 && seconds % 60 === 0) {
        return `${seconds / 60} دقیقه`;
    }
    return `${seconds} ثانیه`;
}

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
     * Post in archive channel (LINKS_CHANNEL_ID) → copy to PRIVATE_CHANNEL_ID, then register link.
     * @param {Object} ctx - Telegram context
     */
    async handleArchiveChannelPost(ctx) {
        const message = ctx.channelPost;
        const file = message.document || message.video || message.audio;

        if (!file) {
            console.log('❌ No file found in archive channel post');
            return;
        }

        const privateChannelId = config.PRIVATE_CHANNEL_ID;
        if (!privateChannelId) {
            console.error('❌ PRIVATE_CHANNEL_ID is not set');
            return;
        }

        try {
            const copied = await ctx.telegram.copyMessage(
                privateChannelId,
                ctx.chat.id,
                message.message_id
            );
            const copiedMessageId =
                typeof copied === 'number' ? copied : copied?.message_id;
            if (!copiedMessageId) {
                throw new Error('copyMessage did not return a message_id');
            }
            console.log(
                `✅ Copied archive message ${message.message_id} → private channel message ${copiedMessageId}`
            );

            const storedMessage = { ...message, message_id: copiedMessageId };
            await this._registerNewChannelFile(ctx, storedMessage, privateChannelId);
        } catch (error) {
            console.error('❌ Error ingesting archive channel post:', error);
            if (error.response) {
                console.error('Telegram API:', error.response.description || error.response);
            }
            throw error;
        }
    }

    /**
     * Handle a new file posted directly in the private (links) channel.
     * @param {Object} ctx - Telegram context
     * @returns {Promise<void>}
     */
    async handleNewFile(ctx) {
        try {
            console.log('📨 Processing new file in private channel...');
            await this._registerNewChannelFile(ctx, ctx.channelPost, ctx.chat.id);
        } catch (error) {
            console.error('❌ Error handling new file:', error);
            throw error;
        }
    }

    /**
     * Save file metadata and append key/link to the message in the storage channel.
     * @private
     */
    async _registerNewChannelFile(ctx, message, storageChannelId) {
        const file = message.document || message.video || message.audio;

        if (!file) {
            console.log('❌ No file found in message');
            return;
        }

        const fileKey = generateFileKey();
        console.log(`🔑 Generated file key: ${fileKey}`);

        const botUsername = ctx.botInfo?.username;
        const directLink = `https://t.me/${botUsername}?start=get_${fileKey}`;

        const fileData = this._extractFileData(message, fileKey);
        await databaseService.createFile(fileData);
        console.log(`✅ File saved to database with key: ${fileKey}`);

        await this._updateMessageCaption(ctx, message, fileKey, directLink, storageChannelId);

        scheduleService.onFileRegistered(ctx, fileData).catch((err) => {
            console.error('❌ Schedule onFileRegistered:', err);
        });
    }

    /**
     * @private
     * @param {Object} message
     * @returns {{ type: string, fileId: string, fileName: string, fileSize: number, caption: string } | null}
     */
    _extractMediaUpdateData(message) {
        const caption = message.caption || '';

        if (message.document) {
            return {
                type: 'document',
                fileId: message.document.file_id,
                fileName: message.document.file_name || 'file',
                fileSize: message.document.file_size || 0,
                caption
            };
        }

        if (message.video) {
            return {
                type: 'video',
                fileId: message.video.file_id,
                fileName: message.video.file_name || 'video.mp4',
                fileSize: message.video.file_size || 0,
                caption
            };
        }

        if (message.audio) {
            return {
                type: 'audio',
                fileId: message.audio.file_id,
                fileName: message.audio.file_name || 'audio.mp3',
                fileSize: message.audio.file_size || 0,
                caption
            };
        }

        if (message.photo) {
            const largestPhoto = Array.isArray(message.photo)
                ? message.photo[message.photo.length - 1]
                : message.photo;
            return {
                type: 'photo',
                fileId: largestPhoto.file_id,
                fileName: 'photo.jpg',
                fileSize: largestPhoto.file_size || 0,
                caption
            };
        }

        return null;
    }

    /**
     * Persist metadata (+ optional message id) for an existing file key.
     * @private
     */
    async _syncFileRecordByKey(fileKey, updateData, messageId) {
        await databaseService.upsertFile({
            key: fileKey,
            messageId: messageId ?? updateData.messageId,
            type: updateData.type,
            fileId: updateData.fileId,
            fileName: updateData.fileName,
            fileSize: updateData.fileSize,
            caption: updateData.caption
        });
        console.log(`✅ File record for key ${fileKey} synced (${updateData.fileName}).`);
    }

    /**
     * Resolve file key for sync after channel edit.
     * @private
     */
    async _resolveFileKeyForSync(message, messageId, updateData) {
        const fromCaption = extractFileKeyFromCaption(updateData.caption);
        if (fromCaption) return fromCaption;

        const byMessage = await databaseService.getFileByMessageId(messageId);
        if (byMessage?.key) return byMessage.key;

        return null;
    }

    /**
     * Sync DB metadata after edit/replace — never copies between channels.
     * @private
     */
    async _syncEditedFileMetadata(message, channelLabel) {
        const messageId = message.message_id;
        const updateData = this._extractMediaUpdateData(message);
        if (!updateData) {
            console.log(`❌ No file found in edited ${channelLabel} message`);
            return;
        }

        console.log(
            `✏️ ${channelLabel} edit msg=${messageId} file="${updateData.fileName}" captionKey=${extractFileKeyFromCaption(updateData.caption) ?? '—'}`
        );

        const updated = await databaseService.updateFileByMessageId(messageId, updateData);
        if (updated?.nModified > 0) {
            console.log(`✅ File record for message ${messageId} updated in DB.`);
            return;
        }

        const fileKey = await this._resolveFileKeyForSync(message, messageId, updateData);
        if (!fileKey) {
            console.log(`⚠️ No file record updated for ${channelLabel} msg=${messageId} (key not found).`);
            return;
        }

        const existing = await databaseService.getFileByKey(fileKey);
        const deliveryMessageId = existing?.messageId ?? messageId;

        await this._syncFileRecordByKey(fileKey, updateData, deliveryMessageId);
    }

    /**
     * Sync DB after a file was edited/replaced in the private links channel.
     * @param {Object} ctx
     * @param {Object} message
     */
    async handleEditedPrivateChannelPost(ctx, message) {
        await this._syncEditedFileMetadata(message, 'Links');
    }

    /**
     * @deprecated use handleEditedPrivateChannelPost
     */
    async handleEditedFile(ctx) {
        const message = ctx.editedChannelPost ?? ctx.editedMessage;
        if (!message) return;
        await this.handleEditedPrivateChannelPost(ctx, message);
    }

    /**
     * Archive channel edit/replace → update DB only (no copy to links channel).
     * @param {Object} ctx
     * @param {Object} message
     */
    async handleEditedArchiveChannelPost(ctx, message) {
        const archiveChannelId = getArchiveChannelId();
        if (!archiveChannelId || String(ctx.chat.id).trim() !== archiveChannelId) return;

        await this._syncEditedFileMetadata(message, 'Archive');
    }

    /**
     * Route edited channel/supergroup file post.
     * @param {import('telegraf').Context} ctx
     */
    async handleEditedChannelIntake(ctx) {
        const { getEditedChannelPost } = require('../utils/editedChannelPost');
        const intake = getEditedChannelPost(ctx);
        if (!intake) return false;

        const { post, chatId } = intake;
        const archiveId = getArchiveChannelId();
        const privateId = getPrivateChannelId();

        if (privateId && chatId === privateId) {
            await this.handleEditedPrivateChannelPost(ctx, post);
            return true;
        }

        if (archiveId && chatId === archiveId) {
            await this.handleEditedArchiveChannelPost(ctx, post);
            return true;
        }

        return false;
    }

    /**
     * Send a file to user based on file key
     * @param {Object} ctx - Telegram context
     * @param {string} fileKey - The file key
     * @returns {Promise<boolean>} Whether file was sent successfully
     */
    async sendFileToUser(ctx, fileKey) {
        try {
            console.log(`🔍 Looking up file with key: ${fileKey}`);
            const fileData = await databaseService.getFileByKey(fileKey);
            
            if (!fileData) {
                console.log('❌ File not found in database');
                await botReply.reply(ctx, `${e('warning')} فایل مورد نظر یافت نشد!`);
                return false;
            }
            
            if (!fileData.isActive) {
                console.log('❌ File is no longer active');
                await botReply.reply(ctx, `${e('error')} این فایل دیگر در دسترس نیست.`);
                return false;
            }
            
            console.log('📤 Sending file to user...');

            let forwardedMessage;
            let noticeMessage;
            try {
                forwardedMessage = await ctx.telegram.copyMessage(
                    ctx.chat.id,
                    config.PRIVATE_CHANNEL_ID,
                    fileData.messageId,
                    { caption: '' }
                );
                console.log('✅ File sent successfully');

                noticeMessage = await botReply.reply(
                    ctx,
                    `${e('timer')} فایل‌های ارسالی ربات به دلیل مسائل مشخص، بعد از 30 ثانیه از ربات پاک می‌شوند.\n\n${e('success')} جهت دانلود فایل‌ را به پیام‌های ذخیره‌شده‌ی تلگرام یا چت دیگری فوروارد کنید.`
                );
            } catch (error) {
                console.error('❌ Error copying message:', error);
                await botReply.reply(ctx, `${e('warning')} خطا در ارسال فایل. لطفاً دوباره تلاش کنید.`);
                return false;
            }

            try {
                await databaseService.incrementFileDownloads(fileKey);
            } catch (err) {
                console.error('⚠️ Failed to increment downloads:', err);
            }

            setTimeout(async () => {
                    try {
                        console.log('🔄 Attempting to delete bot messages...');
                        console.log(`Chat ID: ${ctx.chat.id}`);
                        console.log(`Chat Type: ${ctx.chat.type}`);
                        console.log(`Deleting file message: ${forwardedMessage.message_id}`);
                        console.log(`Deleting notice message: ${noticeMessage.message_id}`);

                        // Only delete messages in private chats
                        if (ctx.chat.type === 'private') {
                            try {
                                // Delete the notice message first
                                await ctx.telegram.deleteMessage(ctx.chat.id, noticeMessage.message_id);
                                console.log('✅ Notice message deleted');
                                
                                // Then delete the file message
                                await ctx.telegram.deleteMessage(ctx.chat.id, forwardedMessage.message_id);
                                console.log('✅ File message deleted');
                            } catch (deleteError) {
                                console.error('❌ Error deleting bot messages:', deleteError);
                                if (deleteError.response) {
                                    console.error('Error details:', deleteError.response);
                                }
                            }
                        } else {
                            console.log('❌ Message deletion only works in private chats');
                        }
                    } catch (error) {
                        console.error('❌ Error in deletion process:', error);
                        console.error('Error details:', error.response || error);
                    }
                }, 30000);

            return true;
        } catch (error) {
            console.error('❌ Error in sendFileToUser:', error);
            await botReply.reply(ctx, `${e('warning')} خطا در ارسال فایل. لطفاً دوباره تلاش کنید.`);
            return false;
        }
    }

    /**
     * Send all files in a pack to user
     * @param {Object} ctx - Telegram context
     * @param {string} packSlug - Pack slug
     * @param {{ cancelled?: boolean }} [cancelToken] - Optional cancellation token
     * @returns {Promise<boolean>} Whether sending started successfully
     */
    async sendPackToUser(ctx, packSlug, cancelToken = { cancelled: false }) {
        try {
            const slug = String(packSlug ?? '').trim().toLowerCase();
            if (!slug) {
                await botReply.reply(ctx, `${e('warning')} پک معتبر نیست.`);
                return false;
            }

            console.log(`📦 Looking up file pack with slug: ${slug}`);
            const pack = await databaseService.getFilePackBySlug(slug);

            if (!pack) {
                await botReply.reply(ctx, `${e('warning')} پک مورد نظر یافت نشد!`);
                return false;
            }

            if (pack.isActive === false) {
                await botReply.reply(ctx, `${e('error')} این پک دیگر در دسترس نیست.`);
                return false;
            }

            const items = await databaseService.getFilePackItems(pack.id);
            if (!items || items.length === 0) {
                await botReply.reply(ctx, `${e('warning')} این پک هنوز فایلی ندارد.`);
                return false;
            }

            const packTitle = escapeHtml(pack.title || pack.slug);
            const userId = String(ctx.from.id);

            await botReply.reply(
                ctx,
                `${e('package')} ارسال پک شروع شد: <b>${packTitle}</b>\n` +
                    `تعداد فایل‌ها: ${items.length}`,
                {
                    reply_markup: {
                        inline_keyboard: [[
                            inlineButton({
                                text: 'توقف ارسال',
                                emojiKey: 'stop',
                                callback_data: `cancel_pack_${userId}`
                            })
                        ]]
                    }
                }
            );

            let sent = 0;
            let stopNotified = false;
            const filesToDelete = [];
            const packDeleteDelayLabel = formatPackDeleteDelayFa(PACK_FILE_DELETE_MS);

            const notifyStopped = async () => {
                if (stopNotified) return;
                stopNotified = true;
                await botReply.reply(ctx, `${e('stop')} ارسال پک متوقف شد. (${sent}/${items.length})`);
            };

            try {
                for (const it of items) {
                    if (cancelToken?.cancelled) {
                        await notifyStopped();
                        return true;
                    }

                    const fileKey = String(it.fileKey ?? '').trim();
                    if (!fileKey) continue;

                    const fileData = await databaseService.getFileByKey(fileKey);
                    if (!fileData || !fileData.isActive) {
                        continue;
                    }

                    try {
                        if (cancelToken?.cancelled) {
                            await notifyStopped();
                            return true;
                        }

                        const forwardedMessage = await ctx.telegram.copyMessage(
                            ctx.chat.id,
                            config.PRIVATE_CHANNEL_ID,
                            fileData.messageId,
                            { caption: '' }
                        );

                        sent += 1;
                        filesToDelete.push(forwardedMessage.message_id);

                        try {
                            await databaseService.incrementFileDownloads(fileKey);
                        } catch (incrErr) {
                            console.error('⚠️ Failed to increment pack file downloads:', incrErr);
                        }

                        await delayCancellable(1200, cancelToken);
                    } catch (err) {
                        console.error('❌ Error sending pack file:', err);
                        await delayCancellable(1500, cancelToken);
                    }
                }

                if (cancelToken?.cancelled) {
                    await notifyStopped();
                } else {
                    await botReply.reply(
                        ctx,
                        `${e('success')} ارسال پک تمام شد. (${sent}/${items.length})\n\n` +
                            `${e('timer')} فایل‌های ارسالی ربات ${packDeleteDelayLabel} بعد از اتمام ارسال پک از چت پاک می‌شوند.\n\n` +
                            `${e('warning')} جهت دانلود فایل‌ را به پیام‌های ذخیره‌شده‌ی تلگرام یا چت دیگری فوروارد کنید.`
                    );
                }
            } finally {
                if (filesToDelete.length > 0 && ctx.chat.type === 'private') {
                    const chatId = ctx.chat.id;
                    const messageIds = [...filesToDelete];
                    setTimeout(async () => {
                        for (const messageId of messageIds) {
                            try {
                                await ctx.telegram.deleteMessage(chatId, messageId);
                            } catch {
                                // ignore
                            }
                        }
                    }, PACK_FILE_DELETE_MS);
                }
            }

            return true;
        } catch (error) {
            console.error('❌ Error in sendPackToUser:', error);
            await botReply.reply(ctx, 'متأسفانه خطایی رخ داد. لطفاً دوباره تلاش کنید.');
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