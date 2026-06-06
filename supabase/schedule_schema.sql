-- Run once in Supabase SQL editor

CREATE TABLE IF NOT EXISTS anime_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    filename_title TEXT NOT NULL,
    staff TEXT,
    has_karaoke BOOLEAN NOT NULL DEFAULT false,
    season INT NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'ongoing' CHECK (status IN ('ongoing', 'completed')),
    subtitle_mode TEXT NOT NULL DEFAULT 'per_episode'
        CHECK (subtitle_mode IN ('per_episode', 'pack_only')),
    hashtag TEXT,
    donation_url TEXT,
    synopsis_url TEXT,
    pack_episodes_slug TEXT,
    pack_subtitle_key TEXT,
    template_message_id BIGINT,
    latest_schedule_message_id BIGINT,
    cover_photo_file_id TEXT,
    channel_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_anime_posts_filename_title
    ON anime_posts (lower(filename_title));

CREATE TABLE IF NOT EXISTS anime_registration_pending (
    filename_title TEXT PRIMARY KEY,
    romaji_display TEXT NOT NULL,
    video_key TEXT,
    subtitle_key TEXT,
    asked_at TIMESTAMPTZ,
    registration_step TEXT,
    english_title TEXT,
    synopsis_url TEXT,
    hashtag TEXT,
    subtitle_mode TEXT,
    staff TEXT,
    has_karaoke BOOLEAN,
    cover_photo_file_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS anime_episode_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    anime_id UUID NOT NULL REFERENCES anime_posts(id) ON DELETE CASCADE,
    episode INT NOT NULL CHECK (episode > 0),
    video_key TEXT NOT NULL,
    subtitle_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (anime_id, episode)
);

CREATE TABLE IF NOT EXISTS episode_upload_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    anime_id UUID NOT NULL REFERENCES anime_posts(id) ON DELETE CASCADE,
    episode INT NOT NULL CHECK (episode > 0),
    video_key TEXT,
    subtitle_key TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (anime_id, episode)
);

CREATE TABLE IF NOT EXISTS schedule_pending_releases (
    id BIGSERIAL PRIMARY KEY,
    anime_id UUID NOT NULL REFERENCES anime_posts(id) ON DELETE CASCADE,
    episode INT NOT NULL CHECK (episode > 0),
    video_key TEXT NOT NULL,
    subtitle_key TEXT,
    mark_completed BOOLEAN NOT NULL DEFAULT false,
    proposed_caption TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'publishing', 'scheduled', 'published', 'rejected')),
    admin_preview_chat_id BIGINT,
    admin_preview_message_id BIGINT,
    published_message_id BIGINT,
    publish_at TIMESTAMPTZ,
    needs_cover_photo BOOLEAN NOT NULL DEFAULT false,
    cover_photo_file_id TEXT,
    needs_pack_info BOOLEAN NOT NULL DEFAULT false,
    pack_episodes_slug TEXT,
    pack_subtitle_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedule_pending_status
    ON schedule_pending_releases (status) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_schedule_pending_scheduled
    ON schedule_pending_releases (publish_at)
    WHERE status = 'scheduled';
