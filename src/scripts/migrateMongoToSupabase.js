require('dotenv').config();

const mongoose = require('mongoose');
const File = require('../models/File');
const supabase = require('../services/supabaseClient');

async function migrateMongoToSupabase() {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        throw new Error('MONGODB_URI is not defined in environment variables');
    }

    if (!process.env.SUPABASE_URL) {
        throw new Error('SUPABASE_URL is not defined in environment variables');
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY is not defined in environment variables');
    }

    await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 10000,
        family: 4
    });

    const batchSize = 500;
    let migrated = 0;
    let skipped = 0;

    const cursor = File.find({}).lean().cursor();
    let batch = [];

    async function flush() {
        if (batch.length === 0) return;

        const payload = batch.map(doc => ({
            key: String(doc.key),
            message_id: doc.messageId,
            type: doc.type,
            file_id: doc.fileId,
            file_name: doc.fileName,
            file_size: doc.fileSize ?? 0,
            caption: doc.caption ?? null,
            downloads: doc.downloads ?? 0,
            last_accessed: doc.lastAccessed ? new Date(doc.lastAccessed).toISOString() : null,
            is_active: doc.isActive ?? true,
            created_at: doc.date ? new Date(doc.date).toISOString() : undefined
        }));

        const sanitizedPayload = payload.map(row => {
            const copy = { ...row };
            if (copy.created_at === undefined) {
                delete copy.created_at;
            }
            return copy;
        });

        const { error } = await supabase
            .from('files')
            .upsert(sanitizedPayload, { onConflict: 'key' });

        if (error) {
            throw error;
        }

        migrated += batch.length;
        batch = [];
        process.stdout.write(`\rMigrated: ${migrated}, Skipped: ${skipped}`);
    }

    for await (const doc of cursor) {
        if (!doc.key || !doc.messageId || !doc.fileId || !doc.fileName || !doc.type) {
            skipped += 1;
            continue;
        }

        batch.push(doc);
        if (batch.length >= batchSize) {
            await flush();
        }
    }

    await flush();

    process.stdout.write('\n');
    await mongoose.disconnect();

    console.log('✅ Migration finished');
    console.log(`Total migrated (upserted): ${migrated}`);
    console.log(`Total skipped (invalid rows): ${skipped}`);
}

migrateMongoToSupabase()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('\n❌ Migration failed:', err);
        process.exit(1);
    });
