const {
    getArchiveChannelId,
    getPrivateChannelId,
    getSchedulePublishChannelId,
    getPublicPostsChannelId,
    isScheduleTestMode
} = require('../utils/channelIds');
const archiveMirrorService = require('./archiveMirrorService');

/**
 * @param {import('telegraf').Telegraf} bot
 */
async function logChannelSetup(bot) {
    const archiveId = getArchiveChannelId();
    const privateId = getPrivateChannelId();

    const scheduleId = getSchedulePublishChannelId();
    const productionScheduleId = getPublicPostsChannelId();

    console.log('📡 Channel routing:');
    console.log(`   ARCHIVE (upload)  LINKS_CHANNEL_ID = ${archiveId || '(not set)'}`);
    console.log(`   PRIVATE (links)   PRIVATE_CHANNEL_ID = ${privateId || '(not set)'}`);
    if (isScheduleTestMode()) {
        console.log(`   SCHEDULE (TEST)   SCHEDULE_TEST_CHANNEL_ID = ${scheduleId}`);
        console.log(`   SCHEDULE (prod)   PUBLIC_POSTS_CHANNEL_ID = ${productionScheduleId} (skipped)`);
    } else {
        console.log(`   SCHEDULE (posts)  PUBLIC_POSTS_CHANNEL_ID = ${scheduleId || '(not set)'}`);
    }

    if (!archiveId) {
        console.warn('⚠️ LINKS_CHANNEL_ID is not set — archive → private copy is disabled');
    } else {
        const mirrorStatus = await archiveMirrorService.getStatus();
        console.log(
            `   ARCHIVE MIRROR       ${mirrorStatus.enabled ? 'enabled' : 'disabled'} (source=${mirrorStatus.source})`
        );
    }

    const botId = bot.botInfo?.id;
    if (!botId) {
        console.warn('⚠️ botInfo not ready; skip channel access check');
        return;
    }

    for (const [label, chatId] of [
        ['ARCHIVE', archiveId],
        ['PRIVATE', privateId],
        ['SCHEDULE', scheduleId]
    ]) {
        if (!chatId) continue;
        try {
            const chat = await bot.telegram.getChat(chatId);
            const member = await bot.telegram.getChatMember(chatId, botId);
            console.log(
                `✅ ${label}: "${chat.title}" type=${chat.type} bot=${member.status}`
            );
        } catch (error) {
            console.error(`❌ ${label} (${chatId}): ${error.message}`);
            if (label === 'ARCHIVE') {
                console.error(
                    '   → بات در کانال آرشیو ادمین نیست یا LINKS_CHANNEL_ID اشتباه است. تا رفع نشود، پست‌های آرشیو به بات نمی‌رسند.'
                );
            }
            if (label === 'SCHEDULE') {
                console.error(
                    '   → بات در کانال انتشار schedule ادمین نیست — پست‌های TheShioriSub/تست منتشر نمی‌شوند.'
                );
            }
        }
    }
}

module.exports = { logChannelSetup };
