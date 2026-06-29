/**
 * One-time import: Chitose (Chiramune) anime + E01–E13 keys from post 681.
 * Run: node src/scripts/importChiramuneSchedule.js
 * Requires: scripts/sql/schedule_schema.sql applied first.
 */
require('dotenv').config();

if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_INSECURE_TLS === '1') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const scheduleDb = require('../services/scheduleDatabaseService');

const CHANNEL_ID = process.env.PUBLIC_POSTS_CHANNEL_ID || process.env.ADDITIONAL_CHANNEL_ID;

const EPISODES = [
    ['01', '630699570', '767362429'],
    ['02', '308129320', '179604331'],
    ['03', '193523442', '597530653'],
    ['04', '982289394', '157618565'],
    ['05', '826488228', '165531794'],
    ['06', '551632695', '291227437'],
    ['07', '517959748', '127896913'],
    ['08', '327003682', '255691043'],
    ['09', '597978141', '709997006'],
    ['10', '682971159', '644352305'],
    ['11', '657475648', '757630160'],
    ['12', '956542591', '981425366'],
    ['13', '301150675', '980312069']
];

async function main() {
    if (!CHANNEL_ID) {
        throw new Error('PUBLIC_POSTS_CHANNEL_ID or ADDITIONAL_CHANNEL_ID required');
    }

    const anime = await scheduleDb.upsertAnime({
        slug: 'chitose-kun-wa-ramune-bin-no-naka',
        title: 'Chitose Is in the Ramune Bottle',
        filenameTitle: 'chitose-kun wa ramune bin no naka',
        staff: 'Dawn',
        season: 1,
        status: 'ongoing',
        hashtag: '#Chiramune',
        donationUrl: 'https://t.me/TheShiori/6951',
        synopsisUrl: 'https://t.me/TheShioriArchive/507',
        packEpisodesSlug: 'pack_chitose-kun-wa-ramune-bin-no-naka-s1',
        packSubtitleKey: '131796492',
        templateMessageId: 681,
        latestScheduleMessageId: 681,
        channelId: String(CHANNEL_ID)
    });

    console.log(`✅ Anime: ${anime.slug} (${anime.id})`);

    for (const [ep, videoKey, subtitleKey] of EPISODES) {
        await scheduleDb.upsertEpisode(anime.id, Number(ep), videoKey, subtitleKey);
        console.log(`   E${ep} video=${videoKey} sub=${subtitleKey}`);
    }

    console.log('\n✅ Import complete. Ready for E14 test uploads.');
}

main().catch((err) => {
    console.error('❌ Import failed:', err);
    process.exit(1);
});
