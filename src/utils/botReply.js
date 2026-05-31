const { messageOpts } = require('./premiumEmoji');

/**
 * @param {import('telegraf').Context} ctx
 * @param {string} text
 * @param {Record<string, unknown>} [extra]
 */
async function reply(ctx, text, extra = {}) {
    return ctx.reply(text, messageOpts(extra));
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {string} text
 * @param {Record<string, unknown>} [extra]
 */
async function editMessageText(ctx, text, extra = {}) {
    return ctx.editMessageText(text, messageOpts(extra));
}

module.exports = {
    reply,
    editMessageText
};
