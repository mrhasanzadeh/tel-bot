/**
 * Startup checks and admin diagnostics for bot token / webhook hijacking.
 */

function normalizeUsername(value) {
    return String(value ?? '')
        .trim()
        .replace(/^@+/, '')
        .toLowerCase();
}

function getMembershipChannelUsernames() {
    return {
        public: process.env.PUBLIC_CHANNEL_USERNAME,
        additional: process.env.ADDITIONAL_CHANNEL_USERNAME
    };
}

function getAllowlist() {
    const raw = process.env.MEMBERSHIP_CHANNEL_ALLOWLIST?.trim();
    if (!raw) return null;
    return raw
        .split(',')
        .map(normalizeUsername)
        .filter(Boolean);
}

function validateMembershipChannels() {
    const allowlist = getAllowlist();
    if (!allowlist) return [];

    const { public: pub, additional: add } = getMembershipChannelUsernames();
    const configured = [normalizeUsername(pub), normalizeUsername(add)].filter(Boolean);
    const warnings = [];

    for (const username of configured) {
        if (!allowlist.includes(username)) {
            warnings.push(
                `Membership channel @${username} is not in MEMBERSHIP_CHANNEL_ALLOWLIST ` +
                    `(${allowlist.map((u) => `@${u}`).join(', ')})`
            );
        }
    }

    for (const username of allowlist) {
        if (!configured.includes(username)) {
            warnings.push(`Allowlisted channel @${username} is missing from env usernames`);
        }
    }

    return warnings;
}

/**
 * @param {import('telegraf').Telegraf} bot
 * @returns {Promise<object>}
 */
async function fetchWebhookInfo(bot) {
    return bot.telegram.getWebhookInfo();
}

/**
 * Remove webhook so this process can receive updates via long polling.
 * @param {import('telegraf').Telegraf} bot
 * @returns {Promise<{ hadWebhook: boolean, previousUrl: string }>}
 */
async function ensurePollingMode(bot) {
    const info = await fetchWebhookInfo(bot);
    const previousUrl = String(info.url ?? '').trim();

    if (!previousUrl) {
        return { hadWebhook: false, previousUrl: '' };
    }

    console.warn(`⚠️ Unexpected webhook detected: ${previousUrl}`);
    if (info.ip_address) {
        console.warn(`   webhook IP: ${info.ip_address}`);
    }
    if (info.last_error_message) {
        console.warn(`   last webhook error: ${info.last_error_message}`);
    }

    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    console.warn('   → webhook deleted (this bot uses long polling)');

    return { hadWebhook: true, previousUrl };
}

/**
 * @param {import('telegraf').Telegraf} bot
 */
async function runStartupSecurityChecks(bot) {
    const me = await bot.telegram.getMe();
    const { public: pub, additional: add } = getMembershipChannelUsernames();

    console.log('🔒 Security startup');
    console.log(`   bot: @${me.username} (${me.id}) "${me.first_name}"`);
    console.log(`   membership channels: @${pub}, @${additional}`);

    const channelWarnings = validateMembershipChannels();
    for (const warning of channelWarnings) {
        console.error(`❌ SECURITY: ${warning}`);
        if (process.env.SECURITY_STRICT === '1') {
            throw new Error(warning);
        }
    }

    const webhook = await ensurePollingMode(bot);
    if (webhook.hadWebhook) {
        console.error(
            '❌ SECURITY: webhook was set by another process — updates may have been stolen. ' +
                'Revoke BOT_TOKEN in @BotFather if this keeps happening.'
        );
        if (process.env.SECURITY_STRICT === '1') {
            throw new Error(`Unexpected webhook: ${webhook.previousUrl}`);
        }
    } else {
        console.log('   webhook: none (polling OK)');
    }
}

/**
 * @param {import('telegraf').Telegraf} bot
 * @returns {Promise<string>}
 */
async function buildSecurityReport(bot) {
    const me = bot.botInfo ?? (await bot.telegram.getMe());
    const webhook = await fetchWebhookInfo(bot);
    const { public: pub, additional: add } = getMembershipChannelUsernames();
    const allowlist = getAllowlist();
    const channelWarnings = validateMembershipChannels();

    const lines = [
        '🔒 Security report',
        '',
        `Bot: @${me.username} (${me.id})`,
        `Name: ${me.first_name}`,
        '',
        'Membership channels (env):',
        `  PUBLIC: @${pub || '(not set)'}`,
        `  ADDITIONAL: @${add || '(not set)'}`,
        ''
    ];

    if (allowlist) {
        lines.push(`Allowlist: ${allowlist.map((u) => `@${u}`).join(', ')}`, '');
    }

    if (channelWarnings.length > 0) {
        lines.push('⚠️ Channel warnings:');
        for (const warning of channelWarnings) {
            lines.push(`  • ${warning}`);
        }
        lines.push('');
    }

    lines.push(
        'Webhook:',
        webhook.url ? `  ❌ SET: ${webhook.url}` : '  ✅ not set (polling)',
        `  pending updates: ${webhook.pending_update_count ?? 0}`
    );

    if (webhook.ip_address) {
        lines.push(`  IP: ${webhook.ip_address}`);
    }
    if (webhook.last_error_date) {
        lines.push(`  last error: ${webhook.last_error_message || '(unknown)'}`);
    }

    lines.push(
        '',
        'If webhook appears again or users see foreign join messages:',
        '• Revoke token in @BotFather and update .env',
        '• Run only one bot instance (local OR server)',
        '• Audit VPS / GHCR / who has BOT_TOKEN'
    );

    return lines.join('\n');
}

module.exports = {
    runStartupSecurityChecks,
    buildSecurityReport,
    ensurePollingMode
};
