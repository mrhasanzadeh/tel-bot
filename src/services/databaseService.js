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
        this.isConnecting = false;
        this.retryCount = 0;
        this.maxRetries = 5;
    }

    /**
     * Connect to MongoDB database
     * @returns {Promise<void>}
     * @throws {Error} If connection fails
     */
    async connect() {
        try {
            console.log('🔄 Attempting to connect to MongoDB...');
            console.log(`📝 Connection string: ${this.uri}`);
            
            // Set connection options with retry logic
            const options = {
                useNewUrlParser: true,
                useUnifiedTopology: true,
                serverSelectionTimeoutMS: 10000, // 10 seconds
                socketTimeoutMS: 45000, // 45 seconds
                connectTimeoutMS: 10000, // 10 seconds
                retryWrites: true,
                retryReads: true,
                maxPoolSize: 10,
                minPoolSize: 5,
                maxIdleTimeMS: 30000, // 30 seconds
                heartbeatFrequencyMS: 10000, // 10 seconds
                // Add these options to help with connection issues
                ssl: true,
                sslValidate: false,
                directConnection: false,
                // Add these options to help with replica set issues
                replicaSet: 'atlas-biiz9a-shard-0',
                readPreference: 'primaryPreferred'
            };
            
            // Connect to MongoDB
            await mongoose.connect(this.uri, options);
            
            console.log('✅ Connected to MongoDB successfully');
            
            // Set up connection event handlers
            mongoose.connection.on('disconnected', () => {
                console.log('❌ MongoDB disconnected. Attempting to reconnect...');
                this.reconnect();
            });
            
            mongoose.connection.on('error', (err) => {
                console.error('❌ MongoDB connection error:', err);
                this.reconnect();
            });
            
            return true;
        } catch (error) {
            console.error('❌ Failed to connect to MongoDB:', error);
            
            // Provide more detailed error information
            if (error.name === 'MongooseServerSelectionError') {
                console.error('🔍 This error often occurs when your IP address is not whitelisted in MongoDB Atlas.');
                console.error('🔍 Please add your IP address to the MongoDB Atlas whitelist:');
                console.error('🔍 1. Go to MongoDB Atlas dashboard');
                console.error('🔍 2. Navigate to Network Access');
                console.error('🔍 3. Click "Add IP Address"');
                console.error('🔍 4. Add your IP address or use "Allow Access from Anywhere" (0.0.0.0/0) for testing');
            }
            
            // Retry connection
            this.reconnect();
            return false;
        }
    }

    // Reconnect to MongoDB with exponential backoff
    async reconnect() {
        if (this.isConnecting) return;
        
        this.isConnecting = true;
        this.retryCount++;
        
        if (this.retryCount > this.maxRetries) {
            console.error(`❌ Failed to connect to MongoDB after ${this.maxRetries} attempts. Giving up.`);
            this.isConnecting = false;
            return;
        }
        
        const delay = Math.min(1000 * Math.pow(2, this.retryCount - 1), 30000); // Exponential backoff with max 30 seconds
        console.log(`🔄 Retrying connection in ${delay / 1000} seconds... (attempt ${this.retryCount}/${this.maxRetries})`);
        
        setTimeout(async () => {
            this.isConnecting = false;
            await this.connect();
        }, delay);
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
}

module.exports = new DatabaseService(); 