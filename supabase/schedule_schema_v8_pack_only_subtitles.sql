-- Run once in Supabase SQL editor (after v7)

ALTER TABLE anime_posts
    ADD COLUMN IF NOT EXISTS subtitle_mode TEXT NOT NULL DEFAULT 'per_episode'
        CHECK (subtitle_mode IN ('per_episode', 'pack_only'));

ALTER TABLE anime_registration_pending
    ADD COLUMN IF NOT EXISTS subtitle_mode TEXT;

ALTER TABLE anime_episode_files
    ALTER COLUMN subtitle_key DROP NOT NULL;

ALTER TABLE schedule_pending_releases
    ALTER COLUMN subtitle_key DROP NOT NULL;
