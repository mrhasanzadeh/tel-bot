const config = require('../../config');

/**
 * @param {string | number | undefined} id
 * @returns {string}
 */
function normalizeChatId(id) {
    if (id === undefined || id === null || id === '') return '';
    return String(id).trim();
}

function getPrivateChannelId() {
    return normalizeChatId(config.PRIVATE_CHANNEL_ID);
}

function getArchiveChannelId() {
    return normalizeChatId(config.ARCHIVE_CHANNEL_ID || config.LINKS_CHANNEL_ID);
}

function getPublicPostsChannelId() {
    return normalizeChatId(
        config.PUBLIC_POSTS_CHANNEL_ID ||
            config.ADDITIONAL_CHANNEL_ID
    );
}

/** Schedule publish target — test channel overrides production when set. */
function getSchedulePublishChannelId() {
    const testId = normalizeChatId(config.SCHEDULE_TEST_CHANNEL_ID);
    if (testId) return testId;
    return getPublicPostsChannelId();
}

function isScheduleTestMode() {
    return Boolean(normalizeChatId(config.SCHEDULE_TEST_CHANNEL_ID));
}

function getAdminUserId() {
    const id = config.ADMIN_USER_ID;
    return id ? String(id).trim() : '';
}

/**
 * @param {import('telegraf').Context} ctx
 * @returns {{ post: object, chatId: string } | null}
 */
function getChannelFilePost(ctx) {
    const chat = ctx.chat;
    if (!chat?.id) return null;

    const chatId = normalizeChatId(chat.id);

    if (ctx.channelPost) {
        const post = ctx.channelPost;
        if (post.document || post.video || post.audio) {
            return { post, chatId };
        }
        return null;
    }

    if (ctx.message && (chat.type === 'channel' || chat.type === 'supergroup')) {
        const post = ctx.message;
        if (post.document || post.video || post.audio) {
            return { post, chatId };
        }
    }

    return null;
}

/**
 * @param {import('telegraf').Context} ctx
 * @returns {boolean}
 */
function isMonitoredChannelChat(ctx) {
    const chatId = normalizeChatId(ctx.chat?.id);
    if (!chatId) return false;
    return chatId === getPrivateChannelId() || chatId === getArchiveChannelId();
}

module.exports = {
    normalizeChatId,
    getPrivateChannelId,
    getArchiveChannelId,
    getPublicPostsChannelId,
    getSchedulePublishChannelId,
    isScheduleTestMode,
    getAdminUserId,
    getChannelFilePost,
    isMonitoredChannelChat
};
