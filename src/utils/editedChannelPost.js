/**
 * Resolve edited channel/supergroup post from Telegraf context.
 * Broadcast channels: edited_channel_post
 * Supergroups (linked discussion / admin uploads): edited_message
 *
 * @param {import('telegraf').Context} ctx
 * @returns {{ post: object, chatId: string } | null}
 */
function getEditedChannelPost(ctx) {
    const chat = ctx.chat;
    if (!chat?.id) return null;

    const chatId = String(chat.id).trim();
    const chatType = chat.type;

    if (ctx.editedChannelPost) {
        const post = ctx.editedChannelPost;
        if (post.document || post.video || post.audio || post.photo) {
            return { post, chatId };
        }
        return null;
    }

    if (
        ctx.editedMessage &&
        (chatType === 'channel' || chatType === 'supergroup')
    ) {
        const post = ctx.editedMessage;
        if (post.document || post.video || post.audio || post.photo) {
            return { post, chatId };
        }
    }

    return null;
}

module.exports = { getEditedChannelPost };
