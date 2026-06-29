/**
 * Incremental merge: Supabase files/packs → main Postgres.
 * Run once before switching tel-bot to DATABASE_URL, or after a gap period.
 *
 * Requires in .env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   DATABASE_URL
 */
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const pg = require('../services/postgresClient');

const BATCH = 500;

async function fetchAll(supabase, table, select) {
    const rows = [];
    let from = 0;

    while (true) {
        const { data, error } = await supabase.from(table).select(select).range(from, from + BATCH - 1);
        if (error) throw error;
        if (!data?.length) break;
        rows.push(...data);
        if (data.length < BATCH) break;
        from += BATCH;
    }

    return rows;
}

async function mergeFiles(client, files) {
    let upserted = 0;
    for (const f of files) {
        await client.query(
            `INSERT INTO files (
                key, message_id, type, file_id, file_name, file_size, caption,
                downloads, last_accessed, is_active, created_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            ON CONFLICT (key) DO UPDATE SET
                message_id = COALESCE(EXCLUDED.message_id, files.message_id),
                type = COALESCE(EXCLUDED.type, files.type),
                file_id = COALESCE(EXCLUDED.file_id, files.file_id),
                file_name = COALESCE(EXCLUDED.file_name, files.file_name),
                file_size = COALESCE(EXCLUDED.file_size, files.file_size),
                caption = COALESCE(EXCLUDED.caption, files.caption),
                downloads = GREATEST(COALESCE(files.downloads,0), COALESCE(EXCLUDED.downloads,0)),
                last_accessed = COALESCE(EXCLUDED.last_accessed, files.last_accessed),
                is_active = COALESCE(EXCLUDED.is_active, files.is_active)`,
            [
                f.key,
                f.message_id,
                f.type,
                f.file_id,
                f.file_name,
                f.file_size,
                f.caption,
                f.downloads ?? 0,
                f.last_accessed,
                f.is_active ?? true,
                f.created_at,
            ]
        );
        upserted += 1;
    }
    return upserted;
}

async function mergePacks(client, packs) {
    for (const p of packs) {
        await client.query(
            `INSERT INTO file_packs (id, slug, title, description, is_active, created_at)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (slug) DO UPDATE SET
                title = EXCLUDED.title,
                description = COALESCE(EXCLUDED.description, file_packs.description),
                is_active = EXCLUDED.is_active`,
            [p.id, p.slug, p.title, p.description, p.is_active ?? true, p.created_at]
        );
    }
    return packs.length;
}

async function mergePackItems(client, items, packs) {
    const slugById = new Map(packs.map((p) => [String(p.id), String(p.slug)]));
    let merged = 0;
    let skipped = 0;

    for (const item of items) {
        const slug = slugById.get(String(item.pack_id));
        if (!slug) {
            skipped += 1;
            continue;
        }

        const { rowCount } = await client.query(
            `INSERT INTO file_pack_items (pack_id, file_key, sort_order, created_at)
             SELECT fp.id, $2, $3, COALESCE($4, now())
             FROM file_packs fp
             WHERE fp.slug = $1
               AND EXISTS (SELECT 1 FROM files f WHERE f.key = $2)
             ON CONFLICT (pack_id, file_key) DO UPDATE SET sort_order = EXCLUDED.sort_order`,
            [slug, item.file_key, item.sort_order ?? 0, item.created_at ?? null]
        );

        if (rowCount > 0) merged += 1;
        else skipped += 1;
    }

    return { merged, skipped };
}

async function main() {
    const url = process.env.SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    }
    if (!process.env.DATABASE_URL?.trim()) {
        throw new Error('DATABASE_URL required');
    }

    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const client = pg.getPool();

    console.log('Fetching from Supabase...');
    const [files, packs, items] = await Promise.all([
        fetchAll(supabase, 'files', '*'),
        fetchAll(supabase, 'file_packs', '*'),
        fetchAll(supabase, 'file_pack_items', '*'),
    ]);

    console.log(`Supabase: ${files.length} files, ${packs.length} packs, ${items.length} pack items`);

    const fileCount = await mergeFiles(client, files);
    console.log(`✅ Files upserted: ${fileCount}`);

    const packCount = await mergePacks(client, packs);
    console.log(`✅ Packs upserted: ${packCount}`);

    const { merged, skipped } = await mergePackItems(client, items, packs);
    console.log(`✅ Pack items merged: ${merged}, skipped: ${skipped}`);

    await pg.getPool().end();
    console.log('Done.');
}

main().catch((err) => {
    console.error('❌ Merge failed:', err);
    process.exit(1);
});
