const pg = require('./postgresClient');

/**
 * File + pack persistence on the main Postgres (shared with shiori-api).
 */
class DatabaseService {
    constructor() {
        if (DatabaseService.instance) {
            return DatabaseService.instance;
        }
        DatabaseService.instance = this;
        this.isConnected = false;
    }

    async connect() {
        if (this.isConnected) return;

        await pg.query('SELECT key FROM files LIMIT 1');
        console.log('✅ Successfully connected to Postgres (files)');
        this.isConnected = true;
    }

    async _ensureConnection() {
        if (!this.isConnected) {
            console.log('🔄 Connecting to Postgres...');
            await this.connect();
        }
    }

    _fromDb(row) {
        if (!row) return null;
        return {
            key: row.key,
            messageId: row.message_id != null ? Number(row.message_id) : null,
            type: row.type ?? null,
            fileId: row.file_id ?? null,
            fileName: row.file_name ?? null,
            fileSize: row.file_size != null ? Number(row.file_size) : null,
            caption: row.caption ?? null,
            date: row.created_at ? new Date(row.created_at) : undefined,
            downloads: row.downloads ?? 0,
            lastAccessed: row.last_accessed ? new Date(row.last_accessed) : undefined,
            isActive: row.is_active ?? true,
        };
    }

    async createFile(fileData) {
        await this._ensureConnection();

        const { rows } = await pg.query(
            `INSERT INTO files (
                key, message_id, type, file_id, file_name, file_size, caption,
                downloads, last_accessed, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *`,
            [
                fileData.key,
                fileData.messageId,
                fileData.type,
                fileData.fileId,
                fileData.fileName ?? null,
                fileData.fileSize ?? null,
                fileData.caption ?? null,
                fileData.downloads ?? 0,
                fileData.lastAccessed ?? null,
                fileData.isActive !== false,
            ]
        );

        console.log(`✅ File saved with key: ${fileData.key}`);
        return this._fromDb(rows[0]);
    }

    async upsertFile(fileData) {
        await this._ensureConnection();

        const { rows } = await pg.query(
            `INSERT INTO files (
                key, message_id, type, file_id, file_name, file_size, caption, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)
            ON CONFLICT (key) DO UPDATE SET
                message_id = EXCLUDED.message_id,
                type = EXCLUDED.type,
                file_id = EXCLUDED.file_id,
                file_name = EXCLUDED.file_name,
                file_size = EXCLUDED.file_size,
                caption = EXCLUDED.caption,
                is_active = true
            RETURNING *`,
            [
                fileData.key,
                fileData.messageId,
                fileData.type,
                fileData.fileId,
                fileData.fileName ?? null,
                fileData.fileSize ?? null,
                fileData.caption ?? null,
            ]
        );

        return this._fromDb(rows[0]);
    }

    async getFileByKey(key) {
        await this._ensureConnection();

        const { rows } = await pg.query(
            `SELECT * FROM files WHERE key = $1 AND is_active = true LIMIT 1`,
            [key]
        );

        if (rows.length === 0) {
            console.log(`⚠️ File not found with key: ${key}`);
            return null;
        }

        return this._fromDb(rows[0]);
    }

    async getFilePackBySlug(slug) {
        await this._ensureConnection();

        const cleanSlug = String(slug ?? '').trim().toLowerCase();
        if (!cleanSlug) return null;

        const { rows } = await pg.query(
            `SELECT id, slug, title, description, is_active, created_at
             FROM file_packs WHERE slug = $1 LIMIT 1`,
            [cleanSlug]
        );

        const data = rows[0];
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

        const { rows } = await pg.query(
            `SELECT pack_id, file_key, sort_order
             FROM file_pack_items
             WHERE pack_id = $1
             ORDER BY sort_order ASC`,
            [cleanId]
        );

        return rows.map((row) => ({
            packId: String(row.pack_id),
            fileKey: String(row.file_key),
            sortOrder: typeof row.sort_order === 'number' ? row.sort_order : Number(row.sort_order ?? 0) || 0,
        }));
    }

    async incrementFileDownloads(key) {
        await this._ensureConnection();

        try {
            const { rows } = await pg.query(`SELECT * FROM increment_file_downloads($1)`, [key]);
            if (rows[0]) {
                console.log(`✅ Downloads incremented for file with key ${key}`);
                return this._fromDb(rows[0]);
            }
        } catch (err) {
            if (err.code !== '42883') {
                throw err;
            }
        }

        const existing = await this.getFileByKey(key);
        if (!existing) {
            console.log(`⚠️ File not found for download increment: ${key}`);
            return null;
        }

        const nextDownloads = (existing.downloads || 0) + 1;
        const { rows } = await pg.query(
            `UPDATE files
             SET downloads = $2, last_accessed = now()
             WHERE key = $1 AND is_active = true
             RETURNING *`,
            [key, nextDownloads]
        );

        console.log(`✅ Downloads incremented for file with key ${key} to ${nextDownloads}`);
        return this._fromDb(rows[0]);
    }

    async getAllFiles(limit = 10, skip = 0) {
        await this._ensureConnection();

        const { rows } = await pg.query(
            `SELECT * FROM files
             WHERE is_active = true
             ORDER BY created_at DESC NULLS LAST
             LIMIT $1 OFFSET $2`,
            [limit, skip]
        );

        return rows.map((row) => this._fromDb(row));
    }

    async deactivateFile(key) {
        await this._ensureConnection();

        const { rows } = await pg.query(
            `UPDATE files
             SET is_active = false, last_accessed = now()
             WHERE key = $1
             RETURNING *`,
            [key]
        );

        console.log(`✅ File deactivated: ${key}`);
        return this._fromDb(rows[0]);
    }

    async getFileStats() {
        await this._ensureConnection();

        const { rows } = await pg.query(
            `SELECT downloads, file_size FROM files WHERE is_active = true`
        );

        const totalFiles = rows.length;
        const totalDownloads = rows.reduce((sum, r) => sum + (r.downloads || 0), 0);
        const totalSize = rows.reduce((sum, r) => sum + Number(r.file_size || 0), 0);
        const averageDownloads = totalFiles > 0 ? totalDownloads / totalFiles : 0;

        return {
            totalFiles,
            totalDownloads,
            totalSize,
            averageDownloads,
        };
    }

    async deactivateFilesByMessageId(messageId) {
        await this._ensureConnection();

        const { rowCount } = await pg.query(
            `UPDATE files
             SET is_active = false, last_accessed = now()
             WHERE message_id = $1 AND is_active = true`,
            [messageId]
        );

        return rowCount || 0;
    }

    async updateFileByMessageId(messageId, updateData) {
        await this._ensureConnection();

        const sets = [];
        const values = [messageId];
        let idx = 2;

        if (updateData.fileId !== undefined) {
            sets.push(`file_id = $${idx++}`);
            values.push(updateData.fileId);
        }
        if (updateData.fileName !== undefined) {
            sets.push(`file_name = $${idx++}`);
            values.push(updateData.fileName);
        }
        if (updateData.fileSize !== undefined) {
            sets.push(`file_size = $${idx++}`);
            values.push(updateData.fileSize);
        }
        if (updateData.caption !== undefined) {
            sets.push(`caption = $${idx++}`);
            values.push(updateData.caption);
        }

        if (sets.length === 0) {
            return { nModified: 0 };
        }

        const { rowCount } = await pg.query(
            `UPDATE files SET ${sets.join(', ')} WHERE message_id = $1`,
            values
        );

        return { nModified: rowCount || 0 };
    }
}

module.exports = new DatabaseService();
