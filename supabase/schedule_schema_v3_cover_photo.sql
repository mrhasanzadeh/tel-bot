-- Run once in Supabase SQL editor (after schedule_schema.sql)

ALTER TABLE schedule_pending_releases
    ADD COLUMN IF NOT EXISTS needs_cover_photo BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE schedule_pending_releases
    ADD COLUMN IF NOT EXISTS cover_photo_file_id TEXT;
