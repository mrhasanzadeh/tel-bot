-- Core file-sharing tables (run once in Supabase SQL editor)

CREATE TABLE IF NOT EXISTS files (
    key TEXT PRIMARY KEY,
    message_id BIGINT NOT NULL,
    type TEXT NOT NULL,
    file_id TEXT NOT NULL,
    file_name TEXT,
    file_size BIGINT,
    caption TEXT,
    downloads INT NOT NULL DEFAULT 0,
    last_accessed TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_files_message_id ON files (message_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_files_active_created ON files (created_at DESC) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS file_packs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS file_pack_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_id UUID NOT NULL REFERENCES file_packs(id) ON DELETE CASCADE,
    file_key TEXT NOT NULL REFERENCES files(key),
    sort_order INT NOT NULL DEFAULT 0,
    UNIQUE (pack_id, file_key)
);

CREATE INDEX IF NOT EXISTS idx_file_pack_items_pack ON file_pack_items (pack_id, sort_order);

CREATE OR REPLACE FUNCTION increment_file_downloads(p_key TEXT)
RETURNS SETOF files
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    UPDATE files
    SET downloads = downloads + 1,
        last_accessed = now()
    WHERE key = p_key AND is_active = true
    RETURNING *;
END;
$$;
