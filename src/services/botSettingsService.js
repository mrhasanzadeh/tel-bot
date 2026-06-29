const api = require('./shioriApiClient');

class BotSettingsService {
    constructor() {
        if (BotSettingsService.instance) {
            return BotSettingsService.instance;
        }
        BotSettingsService.instance = this;
        this.ready = false;
    }

    async ensureReady() {
        if (this.ready) return;
        await api.ping();
        this.ready = true;
    }

    /**
     * @param {string} key
     * @returns {Promise<string|null>}
     */
    async get(key) {
        await this.ensureReady();
        const res = await api.get(`/bot/settings/${encodeURIComponent(key)}`);
        return res?.data?.value ?? null;
    }

    /**
     * @param {string} key
     * @param {string} value
     */
    async set(key, value) {
        await this.ensureReady();
        await api.put(`/bot/settings/${encodeURIComponent(key)}`, { value: String(value) });
    }

    /**
     * @param {string} key
     * @returns {Promise<boolean>}
     */
    async delete(key) {
        await this.ensureReady();
        const res = await api.delete(`/bot/settings/${encodeURIComponent(key)}`);
        return Boolean(res?.data?.deleted);
    }
}

module.exports = new BotSettingsService();
