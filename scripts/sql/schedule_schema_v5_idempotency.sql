-- Run once in Postgres (psql) (after schedule_schema.sql)

ALTER TABLE schedule_pending_releases
    DROP CONSTRAINT IF EXISTS schedule_pending_releases_status_check;

ALTER TABLE schedule_pending_releases
    ADD CONSTRAINT schedule_pending_releases_status_check
    CHECK (status IN ('pending', 'publishing', 'scheduled', 'published', 'rejected'));

-- Close duplicate active pendings (keeps newest per anime+episode from testing)
WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY anime_id, episode
            ORDER BY created_at DESC, id DESC
        ) AS rn
    FROM schedule_pending_releases
    WHERE status IN ('pending', 'publishing')
)
UPDATE schedule_pending_releases AS spr
SET status = 'rejected', updated_at = now()
FROM ranked
WHERE spr.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_pending_one_active_per_episode
    ON schedule_pending_releases (anime_id, episode)
    WHERE status IN ('pending', 'publishing');
