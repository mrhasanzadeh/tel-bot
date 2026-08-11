/**
 * Build TheShioriSub schedule post captions (HTML + premium emoji when configured).
 */

const { e, escapeHtml } = require('../utils/premiumEmoji');
const { buildStaffCreditLabel } = require('../utils/staffFormat');

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

/** Clickable link for HTML parse_mode captions. */
function tgLink(url, label) {
    return `<a href="${url}">${label}</a>`;
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
        hasKaraoke = false,
        season,
        episodes,
        newEpisode,
        completed,
        hashtag,
        donationUrl,
        synopsisUrl,
        packEpisodesSlug,
        packSubtitleKey,
        episodeRangeEnd,
        subtitleMode = 'per_episode'
    } = opts;

    const packOnly = subtitleMode === 'pack_only';

    const lines = [];
    lines.push(`${e('comet')} زیرنویس اختصاصی انیمه‌ی <b>${escapeHtml(title)}</b>`);
    lines.push('');
    lines.push(
        `${e('pencil')} ${buildStaffCreditLabel(hasKaraoke)} <b>${escapeHtml(staff)}</b>`
    );

    for (const ep of episodes) {
        const emoji = ep.episode === newEpisode ? e('arrowDown') : e('check');
        const epLabel = String(ep.episode).padStart(2, '0');
        const videoUrl = fileLink(botUsername, ep.videoKey);
        if (!packOnly && ep.subtitleKey) {
            const subUrl = fileLink(botUsername, ep.subtitleKey);
            lines.push(
                `${emoji} <b>E${epLabel}</b>: ${tgLink(videoUrl, '[1080p][Softsub]')} | ${tgLink(subUrl, 'Subtitle')}`
            );
        } else {
            lines.push(`${emoji} <b>E${epLabel}</b>: ${tgLink(videoUrl, '[1080p][Softsub]')}`);
        }
    }

    if (completed) {
        lines.push('');
        const rangeEnd = String(episodeRangeEnd).padStart(2, '0');
        const rangeStart = '01';
        if (packSubtitleKey) {
            lines.push(
                `${e('package')} S${String(season).padStart(2, '0')}: Subtitle [${rangeStart}-${rangeEnd}] ` +
                    tgLink(fileLink(botUsername, packSubtitleKey), 'Download')
            );
        }
        if (packEpisodesSlug) {
            lines.push(
                `${e('download')} S${String(season).padStart(2, '0')}: Episode [${rangeStart}-${rangeEnd}] ` +
                    `${tgLink(packLink(botUsername, packEpisodesSlug), 'Pack')} ${e('cool')}`
            );
        }
        lines.push('');
        lines.push(`ممنون که ترجمه‌ی تیم شیوری رو برای تماشای این انیمه انتخاب کردید ${e('heart')}`);
    }

    lines.push('');
    if (donationUrl) {
        lines.push(`${e('donation')} ${tgLink(donationUrl, 'Donation')}`);
    }
    if (synopsisUrl) {
        lines.push(`${e('speech')} ${tgLink(synopsisUrl, 'Synopsis')}`);
    }
    if (hashtag) {
        lines.push(`${e('flag')} ${escapeHtml(hashtag)}`);
    }
    lines.push(`${e('chat')} @TheShioriSub`);

    return lines.join('\n');
}

module.exports = {
    buildScheduleCaption,
    fileLink,
    packLink
};
