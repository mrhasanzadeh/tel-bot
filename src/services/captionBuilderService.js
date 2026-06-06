/**
 * Build TheShioriSub schedule post captions (plain text — matches channel style).
 */

/**
 * @param {string} botUsername
 * @param {string} key
 * @returns {string}
 */
function fileLink(botUsername, key) {
    return `https://t.me/${botUsername}?start=get_${key}`;
}

function packLink(botUsername, slug) {
    return `https://t.me/${botUsername}?start=pack_${slug}`;
}

/**
 * @param {object} opts
 * @returns {string}
 */
function buildScheduleCaption(opts) {
    const {
        botUsername,
        title,
        staff,
        season,
        episodes,
        newEpisode,
        completed,
        hashtag,
        donationUrl,
        synopsisUrl,
        packEpisodesSlug,
        packSubtitleKey,
        episodeRangeEnd
    } = opts;

    const lines = [];
    lines.push(`☄️ زیرنویس اختصاصی انیمه‌ی ${title}`);
    lines.push('');
    lines.push(`✏️ Translation & TypeSetting: ${staff}`);

    for (const ep of episodes) {
        const emoji = ep.episode === newEpisode ? '⬇️' : '✔️';
        const epLabel = String(ep.episode).padStart(2, '0');
        lines.push(
            `${emoji} E${epLabel}: [1080p][Softsub] (${fileLink(botUsername, ep.videoKey)}) | ` +
                `Subtitle (${fileLink(botUsername, ep.subtitleKey)})`
        );
    }

    if (completed) {
        lines.push('');
        const rangeEnd = String(episodeRangeEnd).padStart(2, '0');
        const rangeStart = '01';
        if (packSubtitleKey) {
            lines.push(
                `📦 S${String(season).padStart(2, '0')}: Subtitle [${rangeStart}-${rangeEnd}] ` +
                    `(${fileLink(botUsername, packSubtitleKey)})`
            );
        }
        if (packEpisodesSlug) {
            lines.push(
                `📥 S${String(season).padStart(2, '0')}: Episode [${rangeStart}-${rangeEnd}] ` +
                    `(${packLink(botUsername, packEpisodesSlug)}) 🆒`
            );
        }
        lines.push('');
        lines.push('ممنون که ترجمه‌ی تیم شیوری رو برای تماشای این انیمه انتخاب کردید ❤️');
    }

    lines.push('');
    if (donationUrl) {
        lines.push(`❤️ Donation (${donationUrl})`);
    }
    if (synopsisUrl) {
        lines.push(`🗣️ Synopsis (${synopsisUrl})`);
    }
    if (hashtag) {
        lines.push(`🚩 ${hashtag}`);
    }
    lines.push('💬 @TheShioriSub');

    return lines.join('\n');
}

module.exports = {
    buildScheduleCaption,
    fileLink,
    packLink
};
