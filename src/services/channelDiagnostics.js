const { getArchiveChannelId, getPrivateChannelId } = require('../utils/channelIds');

/**
 * @param {import('telegraf').Telegraf} bot
 * @returns {Promise<string>}
 */
async function buildChannelStatusReport(bot) {
    const archiveId = getArchiveChannelId();
    const privateId = getPrivateChannelId();
    const botId = bot.botInfo?.id;
    const lines = [
        '📡 تنظیمات کانال',
        '',
        `ARCHIVE (آپلود) LINKS_CHANNEL_ID:\n  ${archiveId || '❌ تنظیم نشده'}`,
        `PRIVATE (لینک) PRIVATE_CHANNEL_ID:\n  ${privateId || '❌ تنظیم نشده'}`,
        ''
    ];

    if (!botId) {
        lines.push('⚠️ اطلاعات بات هنوز آماده نیست.');
        return lines.join('\n');
    }

    for (const [label, chatId] of [
        ['ARCHIVE', archiveId],
        ['PRIVATE', privateId]
    ]) {
        if (!chatId) continue;
        try {
            const chat = await bot.telegram.getChat(chatId);
            const member = await bot.telegram.getChatMember(chatId, botId);
            const ok = member.status === 'administrator' || member.status === 'creator';
            lines.push(
                `${ok ? '✅' : '❌'} ${label}`,
                `  عنوان: ${chat.title}`,
                `  شناسه: ${chat.id}`,
                `  نوع: ${chat.type}`,
                `  وضعیت بات: ${member.status}`,
                ok ? '' : '  → بات باید ادمین این کانال باشد تا پست‌ها را ببیند.',
                ''
            );
        } catch (error) {
            lines.push(
                `❌ ${label} (${chatId})`,
                `  خطا: ${error.message}`,
                '  → بات احتمالاً عضو/ادمین این کانال نیست.',
                ''
            );
        }
    }

    lines.push(
        'اگر در آرشیو پست می‌کنید و لاگی نمی‌آید:',
        '• بات را در همان کانال (نه گروه کامنت) ادمین کنید',
        '• یک فایل از کانال را به بات در چت خصوصی فوروارد کنید و /chatid بزنید',
        '• شناسه باید با LINKS_CHANNEL_ID یکی باشد'
    );

    return lines.join('\n');
}

module.exports = { buildChannelStatusReport };
