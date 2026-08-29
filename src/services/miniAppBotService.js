const { Telegraf } = require('telegraf');
const config = require('../../config');
const { ensurePollingMode } = require('./botSecurity');
const { setupMiniAppBotHandlers } = require('../handlers/miniAppBotHandlers');

/**
 * Poll @ShioriMiniBot for /start — runs on tel-bot host (Telegram egress works).
 * @returns {Promise<import('telegraf').Telegraf | null>}
 */
async function startMiniAppBot() {
    const token = String(config.MINI_APP_BOT_TOKEN ?? '').trim();
    if (!token) {
        console.log(
            'ℹ️ MINI_APP_BOT_TOKEN not set — @ShioriMiniBot /start welcome disabled'
        );
        return null;
    }

    const bot = new Telegraf(token);

    bot.catch((err, ctx) => {
        console.error(`Mini App bot error (update ${ctx.update?.update_id}):`, err);
    });

    await ensurePollingMode(bot);
    setupMiniAppBotHandlers(bot);

    bot
        .launch({ allowedUpdates: ['message'] })
        .catch((err) => {
            console.error('❌ Mini App bot launch failed:', err);
        });

    console.log(
        `✅ Mini App bot (@${config.TELEGRAM_MINI_APP_BOT_USERNAME}) /start handler started`
    );
    return bot;
}

module.exports = {
    startMiniAppBot
};
