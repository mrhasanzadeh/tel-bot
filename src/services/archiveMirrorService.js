const config = require('../../config');
const botSettingsService = require('./botSettingsService');

const SETTING_KEY = 'archive_mirror_enabled';

class ArchiveMirrorService {
    constructor() {
        if (ArchiveMirrorService.instance) {
            return ArchiveMirrorService.instance;
        }
        ArchiveMirrorService.instance = this;
        /** @type {boolean|null} null = follow env default */
        this.dbOverride = null;
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;
        await botSettingsService.ensureReady();
        const stored = await botSettingsService.get(SETTING_KEY);
        if (stored === 'true') this.dbOverride = true;
        else if (stored === 'false') this.dbOverride = false;
        else this.dbOverride = null;
        this.initialized = true;
    }

    getEnvDefault() {
        return config.ARCHIVE_MIRROR_ENABLED;
    }

    async isEnabled() {
        if (!this.initialized) await this.init();
        if (this.dbOverride !== null) return this.dbOverride;
        return this.getEnvDefault();
    }

    /**
     * @returns {Promise<{ enabled: boolean, source: 'admin'|'env', envDefault: boolean }>}
     */
    async getStatus() {
        if (!this.initialized) await this.init();
        const source = this.dbOverride !== null ? 'admin' : 'env';
        const enabled =
            this.dbOverride !== null ? this.dbOverride : this.getEnvDefault();
        return {
            enabled,
            source,
            envDefault: this.getEnvDefault(),
        };
    }

    /**
     * @param {boolean} enabled
     */
    async setEnabled(enabled) {
        if (!this.initialized) await this.init();
        await botSettingsService.set(SETTING_KEY, enabled ? 'true' : 'false');
        this.dbOverride = enabled;
    }

    async resetToEnvDefault() {
        if (!this.initialized) await this.init();
        await botSettingsService.delete(SETTING_KEY);
        this.dbOverride = null;
    }
}

module.exports = new ArchiveMirrorService();
