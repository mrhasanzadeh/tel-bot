const {
    getArchiveChannelId,
    getPrivateChannelId,
    getChannelFilePost
} = require('../utils/channelIds');

/**
 * Route file posts from archive or private channels.
 * Handles both channel_post (broadcast) and message (supergroup) updates.
 *
 * @param {import('telegraf').Context} ctx
 * @param {import('./fileHandlerService')} fileHandlerService
 * @returns {Promise<boolean>}
 */
async function route(ctx, fileHandlerService) {
    const intake = getChannelFilePost(ctx);
    if (!intake) return false;

    const { post, chatId } = intake;
    const archiveId = getArchiveChannelId();
    const privateId = getPrivateChannelId();

    ctx.channelPost = post;

    if (archiveId && chatId === archiveId) {
        console.log(`📥 Archive file post chat=${chatId} msg=${post.message_id}`);
        await fileHandlerService.handleArchiveChannelPost(ctx);
        return true;
    }

    if (privateId && chatId === privateId) {
        console.log(`📥 Private channel file post chat=${chatId} msg=${post.message_id}`);
        await fileHandlerService.handleNewFile(ctx);
        return true;
    }

    return false;
}

module.exports = { route };
