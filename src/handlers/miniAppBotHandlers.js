const { htmlOpts } = require('../utils/premiumEmoji');
const { e } = require('../utils/premiumEmoji');
const botReply = require('../utils/botReply');
const {
    buildMiniAppWelcomeText,
    buildMiniAppWelcomeKeyboard
} = require('../utils/miniAppWelcome');

function welcomeReplyOpts() {
    return htmlOpts({ reply_markup: buildMiniAppWelcomeKeyboard() });
}

/**
 * @param {import('telegraf').Telegraf} bot
 */
function setupMiniAppBotHandlers(bot) {
    bot.command('start', async (ctx) => {
        try {
            if (ctx.chat?.type !== 'private') return;
            await ctx.reply(buildMiniAppWelcomeText(), welcomeReplyOpts());
        } catch (error) {
            console.error('❌ Mini App bot /start error:', error);
            await botReply.reply(ctx, `${e('error')} متأسفانه خطایی رخ داد. لطفاً دوباره تلاش کنید.`);
        }
    });

    bot.command('help', async (ctx) => {
        if (ctx.chat?.type !== 'private') return;
        await ctx.reply(buildMiniAppWelcomeText(), welcomeReplyOpts());
    });

    bot.on('text', async (ctx) => {
        if (ctx.chat?.type !== 'private') return;
        const text = String(ctx.message?.text ?? '').trim();
        if (!text || text.startsWith('/')) return;
        await ctx.reply(
            `${e('info')} برای باز کردن مینی‌اپ از دکمهٔ زیر استفاده کنید.`,
            htmlOpts({ reply_markup: buildMiniAppWelcomeKeyboard() })
        );
    });
}

module.exports = {
    setupMiniAppBotHandlers
};
