-- v12: link schedule anime_posts → catalog anime (mini-app button)
ALTER TABLE anime_posts
    ADD COLUMN IF NOT EXISTS catalog_anime_id uuid;
