const supabase = require('./supabaseClient');

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
        this.tableName = 'files';
    }

    /**
     * Connect to database
     * @returns {Promise<void>}
     * @throws {Error} If connection fails
     */
    async connect() {
        try {
            if (this.isConnected) {
                return;
            }

            const { error } = await supabase
                .from(this.tableName)
                .select('key', { head: true, count: 'exact' })
                .limit(1);

            if (error) {
                throw error;
            }

            console.log('✅ Successfully connected to Supabase');
            this.isConnected = true;
        } catch (error) {
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
            console.log('🔄 Connecting to Supabase...');
            await this.connect();
        }
    }

    _toDb(fileData) {
        return {
            key: fileData.key,
            message_id: fileData.messageId,
            type: fileData.type,
            file_id: fileData.fileId,
            file_name: fileData.fileName,
            file_size: fileData.fileSize,
            caption: fileData.caption,
            downloads: fileData.downloads,
            last_accessed: fileData.lastAccessed,
            is_active: fileData.isActive
        };
    }

    _fromDb(row) {
        if (!row) return null;
        return {
            key: row.key,
            messageId: row.message_id,
            type: row.type,
            fileId: row.file_id,
            fileName: row.file_name,
            fileSize: row.file_size,
            caption: row.caption,
            date: row.created_at ? new Date(row.created_at) : undefined,
            downloads: row.downloads ?? 0,
            lastAccessed: row.last_accessed ? new Date(row.last_accessed) : undefined,
            isActive: row.is_active ?? true
        };
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

            const insertData = this._toDb(fileData);
            const { data, error } = await supabase
                .from(this.tableName)
                .insert(insertData)
                .select('*')
                .single();

            if (error) {
                throw error;
            }

            console.log(`✅ File saved with key: ${fileData.key}`);
            return this._fromDb(data);
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

            const { data, error } = await supabase
                .from(this.tableName)
                .select('*')
                .eq('key', key)
                .eq('is_active', true)
                .maybeSingle();

            if (error) {
                throw error;
            }

            if (!data) {
                console.log(`⚠️ File not found with key: ${key}`);
            }
            return this._fromDb(data);
        } catch (error) {
            console.error(`❌ Error getting file with key ${key}:`, error);
            throw error;
        }
    }

    async getFilePackBySlug(slug) {
        await this._ensureConnection();

        const cleanSlug = String(slug ?? '').trim().toLowerCase();
        if (!cleanSlug) return null;

        const { data, error } = await supabase
            .from('file_packs')
            .select('id, slug, title, description, is_active, created_at')
            .eq('slug', cleanSlug)
            .maybeSingle();

        if (error) throw error;
        if (!data) return null;
        return {
            id: String(data.id),
            slug: String(data.slug),
            title: String(data.title ?? ''),
            description: data.description ?? null,
            isActive: data.is_active ?? true,
            createdAt: data.created_at ?? null,
        };
    }

    async getFilePackItems(packId) {
        await this._ensureConnection();

        const cleanId = String(packId ?? '').trim();
        if (!cleanId) return [];

        const { data, error } = await supabase
            .from('file_pack_items')
            .select('pack_id, file_key, sort_order')
            .eq('pack_id', cleanId)
            .order('sort_order', { ascending: true });

        if (error) throw error;

        return (data || []).map((row) => ({
            packId: String(row.pack_id),
            fileKey: String(row.file_key),
            sortOrder: typeof row.sort_order === 'number' ? row.sort_order : Number(row.sort_order ?? 0) || 0,
        }));
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

            const { data: rpcData, error: rpcError } = await supabase
                .rpc('increment_file_downloads', { p_key: key })
                .maybeSingle();

            if (!rpcError && rpcData) {
                return this._fromDb(rpcData);
            }

            const existing = await this.getFileByKey(key);
            if (!existing) {
                console.log(`⚠️ File not found for download increment: ${key}`);
                return null;
            }

            const nextDownloads = (existing.downloads || 0) + 1;
            const { data, error } = await supabase
                .from(this.tableName)
                .update({
                    downloads: nextDownloads,
                    last_accessed: new Date().toISOString()
                })
                .eq('key', key)
                .eq('is_active', true)
                .select('*')
                .single();

            if (error) {
                throw error;
            }

            console.log(`✅ Downloads incremented for file with key ${key} to ${nextDownloads}`);
            return this._fromDb(data);
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
            await this._ensureConnection();

            const { data, error } = await supabase
                .from(this.tableName)
                .select('*')
                .eq('is_active', true)
                .order('created_at', { ascending: false })
                .range(skip, skip + limit - 1);

            if (error) {
                throw error;
            }

            return (data || []).map(row => this._fromDb(row));
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
            await this._ensureConnection();

            const { data, error } = await supabase
                .from(this.tableName)
                .update({
                    is_active: false,
                    last_accessed: new Date().toISOString()
                })
                .eq('key', key)
                .select('*')
                .maybeSingle();

            if (error) {
                throw error;
            }

            console.log(`✅ File deactivated: ${key}`);
            return this._fromDb(data);
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
            await this._ensureConnection();

            const { data, error } = await supabase
                .from(this.tableName)
                .select('downloads, file_size')
                .eq('is_active', true);

            if (error) {
                throw error;
            }

            const rows = data || [];
            const totalFiles = rows.length;
            const totalDownloads = rows.reduce((sum, r) => sum + (r.downloads || 0), 0);
            const totalSize = rows.reduce((sum, r) => sum + (r.file_size || 0), 0);
            const averageDownloads = totalFiles > 0 ? totalDownloads / totalFiles : 0;

            return {
                totalFiles,
                totalDownloads,
                totalSize,
                averageDownloads
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
            await this._ensureConnection();

            const { error, count } = await supabase
                .from(this.tableName)
                .update({
                    is_active: false,
                    last_accessed: new Date().toISOString()
                }, { count: 'exact' })
                .eq('message_id', messageId)
                .eq('is_active', true);

            if (error) {
                throw error;
            }

            return count || 0;
        } catch (error) {
            console.error(`❌ Error deactivating files for message ID ${messageId}:`, error);
            throw error;
        }
    }

    /**
     * Update a file record by messageId
     * @param {number} messageId - Telegram message ID
     * @param {Object} updateData - Fields to update
     * @returns {Promise<Object>} Update result
     */
    async updateFileByMessageId(messageId, updateData) {
        try {
            await this._ensureConnection();

            const patch = {};
            if (updateData.fileId !== undefined) patch.file_id = updateData.fileId;
            if (updateData.fileName !== undefined) patch.file_name = updateData.fileName;
            if (updateData.fileSize !== undefined) patch.file_size = updateData.fileSize;
            if (updateData.caption !== undefined) patch.caption = updateData.caption;

            const { error, count } = await supabase
                .from(this.tableName)
                .update(patch, { count: 'exact' })
                .eq('message_id', messageId);

            if (error) {
                throw error;
            }

            return {
                nModified: count || 0
            };
        } catch (error) {
            console.error(`❌ Error updating file for message ID ${messageId}:`, error);
            throw error;
        }
    }
}

module.exports = new DatabaseService();