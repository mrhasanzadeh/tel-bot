-- Run once in Supabase SQL editor (after v6 anime_registration)

ALTER TABLE anime_registration_pending
    ADD COLUMN IF NOT EXISTS registration_step TEXT,
    ADD COLUMN IF NOT EXISTS english_title TEXT,
    ADD COLUMN IF NOT EXISTS synopsis_url TEXT,
    ADD COLUMN IF NOT EXISTS hashtag TEXT,
    ADD COLUMN IF NOT EXISTS subtitle_mode TEXT;
