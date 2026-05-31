const config = require('../../config');
const { e, inlineButton, FALLBACK } = require('./premiumEmoji');
const botReply = require('./botReply');

/**
 * Creates subscription keyboard with channel join button
 * @returns {{ inline_keyboard: import('telegraf/types').InlineKeyboardButton[][] }}
 */
const getSubscriptionKeyboard = () => ({
    inline_keyboard: [
        [
            inlineButton({
                text: 'Join Channel',
                emojiKey: 'megaphone',
                url: `https://t.me/${config.PUBLIC_CHANNEL_USERNAME}`
            })
        ],
        [
            inlineButton({
                text: 'Check Membership',
                emojiKey: 'success',
                callback_data: 'check_membership'
            })
        ]
    ]
});

/**
 * Sends a message to users who aren't channel members
 * @param {Object} ctx - Telegram context
 * @returns {Promise<void>}
 */
async function sendNotMemberMessage(ctx) {
    try {
        const joinText = `${e('megaphone')} To access files, join our channel:`;
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery(
                `${FALLBACK.warning} You need to join all channels! Please join and try again.`,
                { show_alert: true, cache_time: 0 }
            );
            await botReply.editMessageText(ctx, joinText, { reply_markup: getSubscriptionKeyboard() });
        } else {
            await botReply.reply(ctx, joinText, { reply_markup: getSubscriptionKeyboard() });
        }
    } catch (error) {
        console.error('Error sending not member message:', error);
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery(`${FALLBACK.warning} Error sending message`, { show_alert: true, cache_time: 0 });
        }
    }
}

module.exports = {
    getSubscriptionKeyboard,
    sendNotMemberMessage
};
