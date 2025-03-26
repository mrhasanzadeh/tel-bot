const { Markup } = require('telegraf');
const config = require('../../config');

/**
 * Creates subscription keyboard with channel join button
 * @returns {Markup.inlineKeyboard} Telegram inline keyboard markup
 */
const getSubscriptionKeyboard = () => {
    return Markup.inlineKeyboard([
        [Markup.button.url('📢 Join Channel', `https://t.me/${config.PUBLIC_CHANNEL_USERNAME}`)],
        [Markup.button.callback('✅ Check Membership', 'check_membership')]
    ]);
};

/**
 * Sends a message to users who aren't channel members
 * @param {Object} ctx - Telegram context
 * @returns {Promise<void>}
 */
async function sendNotMemberMessage(ctx) {
    try {
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery('⚠️ You need to join all channels! Please join and try again.', { show_alert: true, cache_time: 0 });
            await ctx.editMessageText('📢 To access files, join our channel:', getSubscriptionKeyboard());
        } else {
            await ctx.reply('📢 To access files, join our channel:', getSubscriptionKeyboard());
        }
    } catch (error) {
        console.error('Error sending not member message:', error);
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery('⚠️ Error sending message', { show_alert: true, cache_time: 0 });
        }
    }
}

module.exports = {
    getSubscriptionKeyboard,
    sendNotMemberMessage
}; 