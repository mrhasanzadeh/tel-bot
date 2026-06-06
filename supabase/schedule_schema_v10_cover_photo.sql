-- Run once in Supabase SQL editor (after v9)

ALTER TABLE anime_posts
    ADD COLUMN IF NOT EXISTS cover_photo_file_id TEXT;
