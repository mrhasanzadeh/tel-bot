/**
 * Rebuild the `files` table from the links storage channel (PRIVATE_CHANNEL_ID).
 * Use when `DELETE FROM files` was run but channel messages still exist.
 *
 * Each file post caption must contain: Key: 123456789
 *
 * NOT for TheShioriSub — schedule posts only have ?start=get_KEY links, not the files.
 *
 * Usage:
 *   REINDEX_FROM_ID=1 REINDEX_TO_ID=4000 npm run reindex:channel
 *   REINDEX_DRY_RUN=1  — scan only, no DB writes
 *   REINDEX_CHANNEL_ID=-100...  — override channel (default: PRIVATE_CHANNEL_ID)
 */

require('dotenv').config();

if (process.env.ALLOW_INSECURE_TLS === '1') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const { Telegraf } = require('telegraf');
const supabase = require('../services/supabaseClient');

const CHANNEL_ID = process.env.REINDEX_CHANNEL_ID || process.env.PRIVATE_CHANNEL_ID;
const ADMIN_ID = process.env.ADMIN_USER_ID;
const FROM_ID = Number(process.env.REINDEX_FROM_ID || 1);
const TO_ID = Number(process.env.REINDEX_TO_ID || 5000);
const DELAY_MS = Number(process.env.REINDEX_DELAY_MS || 80);
const DRY_RUN = process.env.REINDEX_DRY_RUN === '1';

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string | undefined} caption
 * @returns {string | null}
 */
function extractKey(caption) {
    const text = String(caption ?? '');
    const match = text.match(/Key:\s*(\d+)/i);
    return match?.[1] ?? null;
}

/**
 * @param {object} message
 * @returns {{ type: string, file_id: string, file_name: string, file_size: number } | null}
 */
function extractFile(message) {
    if (message?.document) {
        return {
            type: 'document',
            file_id: message.document.file_id,
            file_name: message.document.file_name || 'file',
            file_size: message.document.file_size || 0
        };
    }
    if (message?.video) {
        return {
            type: 'video',
            file_id: message.video.file_id,
            file_name: message.video.file_name || 'video.mp4',
            file_size: message.video.file_size || 0
        };
    }
    if (message?.audio) {
        return {
            type: 'audio',
            file_id: message.audio.file_id,
            file_name: message.audio.file_name || 'audio.mp3',
            file_size: message.audio.file_size || 0
        };
    }
    return null;
}

function isMissingMessageError(err) {
    const code = err?.response?.error_code;
    const desc = String(err?.response?.description || err?.message || '').toLowerCase();
    return code === 400 && (desc.includes('not found') || desc.includes("can't be found"));
}

async function main() {
    if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN required');
    if (!CHANNEL_ID) {
        throw new Error('PRIVATE_CHANNEL_ID or REINDEX_CHANNEL_ID required');
    }
    if (!ADMIN_ID) throw new Error('ADMIN_USER_ID required (temporary copy target)');

    const bot = new Telegraf(process.env.BOT_TOKEN);

    console.log(`📡 Reindex channel ${CHANNEL_ID}`);
    console.log(`   message_id ${FROM_ID} → ${TO_ID}`);
    console.log(`   dry_run=${DRY_RUN}`);

    let restored = 0;
    let skipped = 0;
    let notFound = 0;
    let errors = 0;

    for (let msgId = FROM_ID; msgId <= TO_ID; msgId++) {
        try {
            // forwardMessage returns full payload (caption + file); copyMessage only returns message_id
            const forwarded = await bot.telegram.forwardMessage(String(ADMIN_ID), CHANNEL_ID, msgId);
            const caption = forwarded.caption || '';
            const key = extractKey(caption);
            const file = extractFile(forwarded);

            await bot.telegram.deleteMessage(String(ADMIN_ID), forwarded.message_id).catch(() => {});

            if (!file || !key) {
                skipped++;
            } else if (!DRY_RUN) {
                const { error } = await supabase.from('files').upsert(
                    {
                        key,
                        message_id: msgId,
                        type: file.type,
                        file_id: file.file_id,
                        file_name: file.file_name,
                        file_size: file.file_size,
                        caption: caption || null,
                        is_active: true
                    },
                    { onConflict: 'key' }
                );
                if (error) throw error;
                restored++;
            } else {
                restored++;
            }
        } catch (err) {
            if (isMissingMessageError(err)) {
                notFound++;
            } else {
                errors++;
                console.error(`❌ msgId=${msgId}:`, err.response?.description || err.message);
            }
        }

        if (msgId % 200 === 0) {
            console.log(
                `… ${msgId} | restored=${restored} skipped=${skipped} ` +
                    `notFound=${notFound} errors=${errors}`
            );
        }

        await sleep(DELAY_MS);
    }

    console.log('\n✅ Done');
    console.log(`   restored=${restored} skipped=${skipped} notFound=${notFound} errors=${errors}`);
    if (DRY_RUN) {
        console.log('   (dry run — no DB changes)');
    }

    process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('❌ Reindex failed:', err);
    process.exit(1);
});
