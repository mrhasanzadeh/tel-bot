-- Run once in Postgres (psql) (after schedule_schema.sql)

ALTER TABLE schedule_pending_releases
    ADD COLUMN IF NOT EXISTS needs_pack_info BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE schedule_pending_releases
    ADD COLUMN IF NOT EXISTS pack_episodes_slug TEXT;

ALTER TABLE schedule_pending_releases
    ADD COLUMN IF NOT EXISTS pack_subtitle_key TEXT;
