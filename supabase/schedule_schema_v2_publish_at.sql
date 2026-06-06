-- Run once in Supabase SQL editor (after schedule_schema.sql)

ALTER TABLE schedule_pending_releases
    ADD COLUMN IF NOT EXISTS publish_at TIMESTAMPTZ;

ALTER TABLE schedule_pending_releases
    DROP CONSTRAINT IF EXISTS schedule_pending_releases_status_check;

ALTER TABLE schedule_pending_releases
    ADD CONSTRAINT schedule_pending_releases_status_check
    CHECK (status IN ('pending', 'scheduled', 'published', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_schedule_pending_scheduled
    ON schedule_pending_releases (publish_at)
    WHERE status = 'scheduled';
