const { getArchiveChannelId, getPrivateChannelId } = require('../utils/channelIds');

/**
 * @param {import('telegraf').Telegraf} bot
 */
async function logChannelSetup(bot) {
    const archiveId = getArchiveChannelId();
    const privateId = getPrivateChannelId();

    console.log('📡 Channel routing:');
    console.log(`   ARCHIVE (upload)  LINKS_CHANNEL_ID = ${archiveId || '(not set)'}`);
    console.log(`   PRIVATE (links)   PRIVATE_CHANNEL_ID = ${privateId || '(not set)'}`);

    if (!archiveId) {
        console.warn('⚠️ LINKS_CHANNEL_ID is not set — archive → private copy is disabled');
    }

    const botId = bot.botInfo?.id;
    if (!botId) {
        console.warn('⚠️ botInfo not ready; skip channel access check');
        return;
    }

    for (const [label, chatId] of [
        ['ARCHIVE', archiveId],
        ['PRIVATE', privateId]
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
        }
    }
}

module.exports = { logChannelSetup };
