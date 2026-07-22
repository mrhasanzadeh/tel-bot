const { e, escapeHtml, inlineButton } = require('../utils/premiumEmoji');

/**
 * @param {string} userId
 * @param {Record<string, { name: string, isMember: boolean, username?: string|null }>} memberships
 */
function createJoinButtons(userId, memberships) {
    const rows = [];

    for (const [, status] of Object.entries(memberships)) {
        if (status.isMember) continue;
        const username = String(status.username ?? '').trim().replace(/^@/, '');
        if (!username) continue;

        rows.push([
            inlineButton({
                text: `عضویت در ${status.name}`,
                emojiKey: 'users',
                url: `https://t.me/${username}`
            })
        ]);
    }

    rows.push([
        inlineButton({
            text: 'بررسی عضویت',
            emojiKey: 'success',
            callback_data: `check_membership_${userId}`
        })
    ]);

    return { inline_keyboard: rows };
}

/**
 * @param {Record<string, { name: string, isMember: boolean }>} memberships
 */
function createMembershipMessage(memberships) {
    let message = `${e('megaphone')} وضعیت عضویت شما:\n\n`;

    for (const [, status] of Object.entries(memberships)) {
        const emoji = status.isMember ? e('success') : e('error');
        message += `${emoji} ${escapeHtml(status.name)}\n`;
    }

    message += '\nبرای دریافت فایل، لطفاً در همه کانال‌ها عضو شوید.';
    return message;
}

/**
 * @param {Array<{ channel_username?: string|null, title?: string }>} channels
 */
function createWelcomeChannelList(channels) {
    if (!channels.length) {
        const lines = [];
        if (process.env.PUBLIC_CHANNEL_USERNAME) {
            lines.push(`• https://t.me/${process.env.PUBLIC_CHANNEL_USERNAME}`);
        }
        if (process.env.ADDITIONAL_CHANNEL_USERNAME) {
            lines.push(`• https://t.me/${process.env.ADDITIONAL_CHANNEL_USERNAME}`);
        }
        return lines.join('\n');
    }

    return channels
        .map((channel) => {
            const username = String(channel.channel_username ?? '').trim().replace(/^@/, '');
            if (username) {
                return `• https://t.me/${username}`;
            }
            return `• ${channel.title || 'کانال'}`;
        })
        .join('\n');
}

module.exports = {
    createJoinButtons,
    createMembershipMessage,
    createWelcomeChannelList
};
