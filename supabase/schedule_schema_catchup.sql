-- Run once if you created the DB from an older schedule_schema.sql
-- Safe to re-run (IF NOT EXISTS / idempotent where possible)

-- v3: cover photo for new anime
ALTER TABLE schedule_pending_releases
    ADD COLUMN IF NOT EXISTS needs_cover_photo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE schedule_pending_releases
    ADD COLUMN IF NOT EXISTS cover_photo_file_id TEXT;

-- v4: pack info on pending release
ALTER TABLE schedule_pending_releases
    ADD COLUMN IF NOT EXISTS needs_pack_info BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE schedule_pending_releases
    ADD COLUMN IF NOT EXISTS pack_episodes_slug TEXT;
ALTER TABLE schedule_pending_releases
    ADD COLUMN IF NOT EXISTS pack_subtitle_key TEXT;

-- v5: idempotency (see v5 file for duplicate cleanup if index fails)
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_pending_active_episode
    ON schedule_pending_releases (anime_id, episode)
    WHERE status IN ('pending', 'publishing');

-- v6: new anime registration
CREATE TABLE IF NOT EXISTS anime_registration_pending (
    filename_title TEXT PRIMARY KEY,
    romaji_display TEXT NOT NULL,
    video_key TEXT,
    subtitle_key TEXT,
    asked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- v7: registration steps
ALTER TABLE anime_registration_pending
    ADD COLUMN IF NOT EXISTS registration_step TEXT;
ALTER TABLE anime_registration_pending
    ADD COLUMN IF NOT EXISTS english_title TEXT;
ALTER TABLE anime_registration_pending
    ADD COLUMN IF NOT EXISTS synopsis_url TEXT;
ALTER TABLE anime_registration_pending
    ADD COLUMN IF NOT EXISTS hashtag TEXT;
ALTER TABLE anime_registration_pending
    ADD COLUMN IF NOT EXISTS subtitle_mode TEXT;

-- v8: pack-only subtitles
ALTER TABLE anime_posts
    ADD COLUMN IF NOT EXISTS subtitle_mode TEXT NOT NULL DEFAULT 'per_episode';
ALTER TABLE anime_posts DROP CONSTRAINT IF EXISTS anime_posts_subtitle_mode_check;
ALTER TABLE anime_posts
    ADD CONSTRAINT anime_posts_subtitle_mode_check
    CHECK (subtitle_mode IN ('per_episode', 'pack_only'));

ALTER TABLE anime_episode_files
    ALTER COLUMN subtitle_key DROP NOT NULL;
ALTER TABLE schedule_pending_releases
    ALTER COLUMN subtitle_key DROP NOT NULL;

-- v9: staff + karaoke
ALTER TABLE anime_posts
    ADD COLUMN IF NOT EXISTS has_karaoke BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE anime_registration_pending
    ADD COLUMN IF NOT EXISTS staff TEXT;
ALTER TABLE anime_registration_pending
    ADD COLUMN IF NOT EXISTS has_karaoke BOOLEAN;

-- v10: reuse cover image for all episode posts (sendPhoto + premium caption)
ALTER TABLE anime_posts
    ADD COLUMN IF NOT EXISTS cover_photo_file_id TEXT;

-- v11: cover photo during anime registration (before success message)
ALTER TABLE anime_registration_pending
    ADD COLUMN IF NOT EXISTS cover_photo_file_id TEXT;
