const { generateFileKey } = require('../utils/logger');
const mongoose = require('mongoose');
const File = require('../models/File');

class FileService {
    constructor() {
        this.connect();
    }

    async connect() {
        try {
            const uri = process.env.MONGODB_URI;
            if (!uri) {
                throw new Error('MONGODB_URI is not defined in environment variables');
            }
            await mongoose.connect(uri, {
                useNewUrlParser: true,
                useUnifiedTopology: true
            });
            console.log('✅ Connected to MongoDB in FileService');
        } catch (error) {
            console.error('❌ MongoDB connection error in FileService:', error);
            throw error;
        }
    }

    async handleNewFile(ctx, file) {
        try {
            const fileKey = generateFileKey();
            
            // تعیین نوع فایل
            let fileType = 'document';
            if (ctx.channelPost.photo) fileType = 'photo';
            else if (ctx.channelPost.video) fileType = 'video';
            else if (ctx.channelPost.audio) fileType = 'audio';
            else if (ctx.channelPost.text) fileType = 'text';

            // ذخیره اطلاعات فایل در دیتابیس
            const fileData = {
                key: fileKey,
                messageId: ctx.channelPost.message_id,
                type: fileType,
                fileId: file.file_id,
                fileName: file.file_name,
                fileSize: file.file_size,
                date: Date.now(),
                isActive: true,
                downloads: 0
            };

            await File.create(fileData);
            console.log(`✅ File saved to database with key: ${fileKey}`);

            // ایجاد لینک مستقیم
            const directLink = `https://t.me/${ctx.botInfo.username}?start=get_${fileKey}`;
            
            // اضافه کردن کلید و لینک به کپشن فایل
            const caption = ctx.channelPost.caption || '';
            const newCaption = `${caption}\n\n🔑 Key: ${fileKey}\n📱 Direct Link: ${directLink}`;
            
            try {
                // Check if bot is admin and can edit messages
                const chatMember = await ctx.telegram.getChatMember(ctx.chat.id, ctx.botInfo.id);
                const isAdmin = chatMember.status === 'administrator';
                const canEditMessages = chatMember.can_edit_messages;

                if (isAdmin && canEditMessages) {
                    await ctx.telegram.editMessageCaption(ctx.chat.id, ctx.channelPost.message_id, null, newCaption);
                    console.log('✅ Caption updated successfully');
                } else {
                    // If bot can't edit messages, send a new message with the information
                    await ctx.telegram.sendMessage(
                        ctx.chat.id,
                        `📎 File Information:\n\n🔑 Key: ${fileKey}\n📱 Direct Link: ${directLink}\n📅 Date: ${new Date().toLocaleString('en-US')}`,
                        { reply_to_message_id: ctx.channelPost.message_id }
                    );
                    console.log('ℹ️ Sent file information in a new message');
                }
            } catch (error) {
                console.error('Error handling caption:', error.message);
                // Send a new message with the information if editing fails
                try {
                    await ctx.telegram.sendMessage(
                        ctx.chat.id,
                        `📎 File Information:\n\n🔑 Key: ${fileKey}\n📱 Direct Link: ${directLink}\n📅 Date: ${new Date().toLocaleString('en-US')}`,
                        { reply_to_message_id: ctx.channelPost.message_id }
                    );
                    console.log('ℹ️ Sent file information in a new message after error');
                } catch (sendError) {
                    console.error('Error sending file information:', sendError.message);
                }
            }

            return fileKey;
        } catch (error) {
            console.error('Error handling file:', error.message);
            throw error;
        }
    }

    async getFileByKey(key) {
        try {
            const file = await File.findOne({ key, isActive: true });
            if (file) {
                await file.incrementDownloads();
            }
            return file;
        } catch (error) {
            console.error('Error getting file:', error.message);
            throw error;
        }
    }

    async getAllFiles() {
        try {
            return await File.find({ isActive: true }).sort({ date: -1 });
        } catch (error) {
            console.error('Error getting all files:', error.message);
            throw error;
        }
    }

    async deactivateFile(key) {
        try {
            return await File.findOneAndUpdate(
                { key },
                { isActive: false },
                { new: true }
            );
        } catch (error) {
            console.error('Error deactivating file:', error.message);
            throw error;
        }
    }

    async getFileStats() {
        try {
            return await File.aggregate([
                {
                    $group: {
                        _id: null,
                        totalFiles: { $sum: 1 },
                        totalDownloads: { $sum: "$downloads" },
                        totalSize: { $sum: "$fileSize" },
                        averageDownloads: { $avg: "$downloads" }
                    }
                }
            ]);
        } catch (error) {
            console.error('Error getting file stats:', error.message);
            throw error;
        }
    }
}

module.exports = new FileService(); 