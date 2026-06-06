-- Run once in Supabase SQL editor (after schedule_schema.sql)

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
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
