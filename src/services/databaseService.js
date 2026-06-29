const api = require('./shioriApiClient');

/**
 * File + pack persistence via api.shiori.cloud (no direct Postgres).
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

        await api.ping();
        console.log('✅ Successfully connected to Shiori API (files)');
        this.isConnected = true;
    }

    async _ensureConnection() {
        if (!this.isConnected) {
            console.log('🔄 Connecting to Shiori API...');
            await this.connect();
        }
    }

    _fromApi(data) {
        if (!data) return null;
        return {
            key: data.key,
            messageId: data.messageId != null ? Number(data.messageId) : null,
            type: data.type ?? null,
            fileId: data.fileId ?? null,
            fileName: data.fileName ?? null,
            fileSize: data.fileSize != null ? Number(data.fileSize) : null,
            caption: data.caption ?? null,
            date: data.createdAt ? new Date(data.createdAt) : undefined,
            downloads: data.downloads ?? 0,
            lastAccessed: data.lastAccessed ? new Date(data.lastAccessed) : undefined,
            isActive: data.isActive ?? true
        };
    }

    async createFile(fileData) {
        await this._ensureConnection();

        const res = await api.post('/bot/files', {
            key: fileData.key,
            messageId: fileData.messageId,
            type: fileData.type,
            fileId: fileData.fileId,
            fileName: fileData.fileName ?? null,
            fileSize: fileData.fileSize ?? null,
            caption: fileData.caption ?? null,
            downloads: fileData.downloads ?? 0,
            isActive: fileData.isActive !== false
        });

        console.log(`✅ File saved with key: ${fileData.key}`);
        return this._fromApi(res?.data);
    }

    async upsertFile(fileData) {
        await this._ensureConnection();

        const res = await api.put(`/bot/files/${encodeURIComponent(fileData.key)}`, {
            messageId: fileData.messageId,
            type: fileData.type,
            fileId: fileData.fileId,
            fileName: fileData.fileName ?? null,
            fileSize: fileData.fileSize ?? null,
            caption: fileData.caption ?? null
        });

        return this._fromApi(res?.data);
    }

    async getFileByKey(key) {
        await this._ensureConnection();

        const res = await api.get(`/bot/files/${encodeURIComponent(key)}`);
        if (!res?.data) {
            console.log(`⚠️ File not found with key: ${key}`);
            return null;
        }

        return this._fromApi(res.data);
    }

    async getFilePackBySlug(slug) {
        await this._ensureConnection();

        const cleanSlug = String(slug ?? '').trim().toLowerCase();
        if (!cleanSlug) return null;

        const res = await api.get(`/bot/packs/${encodeURIComponent(cleanSlug)}`);
        const data = res?.data;
        if (!data) return null;

        return {
            id: String(data.id),
            slug: String(data.slug),
            title: String(data.title ?? ''),
            description: data.description ?? null,
            isActive: data.isActive ?? true,
            createdAt: data.createdAt ?? null
        };
    }

    async getFilePackItems(packId) {
        await this._ensureConnection();

        const cleanId = String(packId ?? '').trim();
        if (!cleanId) return [];

        const res = await api.get(`/bot/packs/${encodeURIComponent(cleanId)}/items`);
        const items = res?.data ?? [];

        return items.map((row) => ({
            packId: String(row.packId),
            fileKey: String(row.fileKey),
            sortOrder:
                typeof row.sortOrder === 'number'
                    ? row.sortOrder
                    : Number(row.sortOrder ?? 0) || 0
        }));
    }

    async incrementFileDownloads(key) {
        await this._ensureConnection();

        const res = await api.post(`/bot/files/${encodeURIComponent(key)}/downloads`);
        if (!res?.data) {
            console.log(`⚠️ File not found for download increment: ${key}`);
            return null;
        }

        console.log(`✅ Downloads incremented for file with key ${key}`);
        return this._fromApi(res.data);
    }

    async deactivateFilesByMessageId(messageId) {
        await this._ensureConnection();

        const res = await api.post(
            `/bot/files/by-message/${encodeURIComponent(messageId)}/deactivate`
        );
        return res?.data?.count ?? 0;
    }

    async updateFileByMessageId(messageId, updateData) {
        await this._ensureConnection();

        const body = {};
        if (updateData.fileId !== undefined) body.fileId = updateData.fileId;
        if (updateData.fileName !== undefined) body.fileName = updateData.fileName;
        if (updateData.fileSize !== undefined) body.fileSize = updateData.fileSize;
        if (updateData.caption !== undefined) body.caption = updateData.caption;

        if (Object.keys(body).length === 0) {
            return { nModified: 0 };
        }

        const res = await api.patch(
            `/bot/files/by-message/${encodeURIComponent(messageId)}`,
            body
        );
        return { nModified: res?.data?.nModified ?? 0 };
    }
}

module.exports = new DatabaseService();
