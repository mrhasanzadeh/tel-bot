const mongoose = require('mongoose');
const File = require('../models/File');
const config = require('../../config');

/**
 * Service for database operations
 * @class DatabaseService
 */
class DatabaseService {
    /**
     * Create a new database service instance
     */
    constructor() {
        if (DatabaseService.instance) {
            return DatabaseService.instance;
        }
        DatabaseService.instance = this;
        this.isConnected = false;
        this.connectionAttempts = 0;
        this.maxConnectionAttempts = 3;
    }

    /**
     * Connect to MongoDB database
     * @returns {Promise<void>}
     * @throws {Error} If connection fails
     */
    async connect() {
        try {
            if (mongoose.connection.readyState === 1) {
                console.log('✅ Already connected to MongoDB');
                return;
            }

            // Check if MongoDB URI is available
            if (!config.MONGODB_URI) {
                throw new Error('MONGODB_URI environment variable is not set');
            }

            console.log('🔄 Attempting to connect to MongoDB...');
            // Safely log the connection string without credentials
            const connectionString = config.MONGODB_URI;
            const maskedUri = connectionString.replace(/(mongodb:\/\/)([^:]+):([^@]+)@/, '$1****:****@');
            console.log('📝 Connection string:', maskedUri);
            
            await mongoose.connect(config.MONGODB_URI, {
                serverSelectionTimeoutMS: 10000,
                socketTimeoutMS: 45000,
                family: 4, // Force IPv4
                retryWrites: true,
                w: 'majority',
                maxPoolSize: 10,
                minPoolSize: 5,
                heartbeatFrequencyMS: 10000,
                retryReads: true
            });

            console.log('✅ Successfully connected to MongoDB');
            this.isConnected = true;
            this.connectionAttempts = 0;
            
            mongoose.connection.on('error', (err) => {
                console.error('❌ MongoDB connection error:', err);
                this.isConnected = false;
            });

            mongoose.connection.on('disconnected', () => {
                console.warn('⚠️ MongoDB disconnected');
                this.isConnected = false;
            });

            mongoose.connection.on('reconnected', () => {
                console.log('✅ MongoDB reconnected');
                this.isConnected = true;
            });

        } catch (error) {
            this.connectionAttempts++;
            console.error(`❌ Failed to connect to MongoDB (attempt ${this.connectionAttempts}/${this.maxConnectionAttempts}):`, error);
            
            if (this.connectionAttempts < this.maxConnectionAttempts) {
                console.log(`🔄 Retrying connection in 5 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
                return this.connect();
            }
            
            throw error;
        }
    }

    /**
     * Ensure database connection is active
     * @private
     * @returns {Promise<void>}
     */
    async _ensureConnection() {
        if (!this.isConnected) {
            console.log('🔄 Reconnecting to MongoDB...');
            await this.connect();
        }
    }

    /**
     * Create a new file record
     * @param {Object} fileData - The file data
     * @returns {Promise<Object>} Created file object
     * @throws {Error} If file creation fails
     */
    async createFile(fileData) {
        try {
            await this._ensureConnection();
            const file = new File(fileData);
            await file.save();
            console.log(`✅ File saved with key: ${fileData.key}`);
            return file;
        } catch (error) {
            console.error('❌ Error saving file:', error);
            throw error;
        }
    }

    /**
     * Get file by its unique key
     * @param {string} key - The file key
     * @returns {Promise<Object|null>} File object or null if not found
     * @throws {Error} If database query fails
     */
    async getFileByKey(key) {
        try {
            await this._ensureConnection();
            const file = await File.findOne({ key, isActive: true });
            if (!file) {
                console.log(`⚠️ File not found with key: ${key}`);
            }
            return file;
        } catch (error) {
            console.error(`❌ Error getting file with key ${key}:`, error);
            throw error;
        }
    }

    /**
     * Increment download count for a file
     * @param {string} key - The file key
     * @returns {Promise<Object|null>} Updated file or null if not found
     * @throws {Error} If update fails
     */
    async incrementFileDownloads(key) {
        try {
            await this._ensureConnection();
            const file = await File.findOne({ key, isActive: true });
            if (!file) {
                console.log(`⚠️ File not found for download increment: ${key}`);
                return null;
            }
            
            file.downloads += 1;
            file.lastAccessed = new Date();
            await file.save();
            console.log(`✅ Downloads incremented for file with key ${key} to ${file.downloads}`);
            return file;
        } catch (error) {
            console.error(`❌ Error incrementing downloads for file with key ${key}:`, error);
            throw error;
        }
    }

    /**
     * Get paginated list of active files
     * @param {number} [limit=10] - Maximum number of files to return
     * @param {number} [skip=0] - Number of files to skip
     * @returns {Promise<Array>} Array of file objects
     * @throws {Error} If query fails
     */
    async getAllFiles(limit = 10, skip = 0) {
        try {
            return await File.find({ isActive: true })
                .sort({ date: -1 })
                .skip(skip)
                .limit(limit);
        } catch (error) {
            console.error('❌ Error getting all files:', error);
            throw error;
        }
    }

    /**
     * Mark a file as inactive (soft delete)
     * @param {string} key - The file key
     * @returns {Promise<Object|null>} Updated file or null if not found
     * @throws {Error} If update fails
     */
    async deactivateFile(key) {
        try {
            const file = await File.findOneAndUpdate(
                { key },
                { isActive: false },
                { new: true }
            );
            console.log(`✅ File deactivated: ${key}`);
            return file;
        } catch (error) {
            console.error('❌ Error deactivating file:', error);
            throw error;
        }
    }

    /**
     * Get statistics about files in the database
     * @returns {Promise<Object>} Statistics object
     * @throws {Error} If aggregation fails
     */
    async getFileStats() {
        try {
            const stats = await File.aggregate([
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
            return stats[0] || {
                totalFiles: 0,
                totalDownloads: 0,
                totalSize: 0,
                averageDownloads: 0
            };
        } catch (error) {
            console.error('❌ Error getting file stats:', error);
            throw error;
        }
    }

    /**
     * Deactivate files by their message ID
     * @param {number} messageId - The Telegram message ID
     * @returns {Promise<number>} Number of deactivated files
     * @throws {Error} If update fails
     */
    async deactivateFilesByMessageId(messageId) {
        try {
            const result = await File.updateMany(
                { messageId, isActive: true },
                { isActive: false, lastAccessed: new Date() }
            );
            
            return result.modifiedCount;
        } catch (error) {
            console.error(`❌ Error deactivating files for message ID ${messageId}:`, error);
            throw error;
        }
    }

    async addPendingDeletion(deletionInfo) {
        try {
            const collection = this.db.collection('pendingDeletions');
            await collection.insertOne({
                ...deletionInfo,
                createdAt: new Date(),
                status: 'pending'
            });
            console.log('✅ Added pending deletion:', deletionInfo);
        } catch (error) {
            console.error('❌ Error adding pending deletion:', error);
            throw error;
        }
    }

    async getPendingDeletions() {
        try {
            const collection = this.db.collection('pendingDeletions');
            const now = new Date();
            return await collection.find({
                status: 'pending',
                deleteAt: { $lte: now }
            }).toArray();
        } catch (error) {
            console.error('❌ Error getting pending deletions:', error);
            throw error;
        }
    }

    async markDeletionAsComplete(messageIds) {
        try {
            const collection = this.db.collection('pendingDeletions');
            await collection.updateMany(
                { messageIds: { $in: messageIds } },
                { $set: { status: 'completed' } }
            );
        } catch (error) {
            console.error('❌ Error marking deletion as complete:', error);
            throw error;
        }
    }
}

module.exports = new DatabaseService(); 