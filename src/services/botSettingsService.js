const pg = require('./postgresClient');

const ENSURE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS bot_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

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
        await pg.query(ENSURE_TABLE_SQL);
        this.ready = true;
    }

    /**
     * @param {string} key
     * @returns {Promise<string|null>}
     */
    async get(key) {
        await this.ensureReady();
        const { rows } = await pg.query(
            `SELECT value FROM bot_settings WHERE key = $1 LIMIT 1`,
            [key]
        );
        return rows[0]?.value ?? null;
    }

    /**
     * @param {string} key
     * @param {string} value
     */
    async set(key, value) {
        await this.ensureReady();
        await pg.query(
            `INSERT INTO bot_settings (key, value, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (key) DO UPDATE SET
                value = EXCLUDED.value,
                updated_at = NOW()`,
            [key, value]
        );
    }

    /**
     * @param {string} key
     * @returns {Promise<boolean>}
     */
    async delete(key) {
        await this.ensureReady();
        const { rowCount } = await pg.query(`DELETE FROM bot_settings WHERE key = $1`, [key]);
        return (rowCount || 0) > 0;
    }
}

module.exports = new BotSettingsService();
