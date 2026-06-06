-- Run once in Supabase SQL editor (after v8)

ALTER TABLE anime_posts
    ADD COLUMN IF NOT EXISTS has_karaoke BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE anime_registration_pending
    ADD COLUMN IF NOT EXISTS staff TEXT;

ALTER TABLE anime_registration_pending
    ADD COLUMN IF NOT EXISTS has_karaoke BOOLEAN;
