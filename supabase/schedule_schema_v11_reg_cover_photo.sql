-- Run once in Supabase SQL editor (after v10)

ALTER TABLE anime_registration_pending
    ADD COLUMN IF NOT EXISTS cover_photo_file_id TEXT;
