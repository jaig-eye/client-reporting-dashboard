-- 178: Archive flag for content_posts — lets admins hide published posts from the
-- review UI without deleting them from WordPress/BigCommerce.
ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS content_posts_archived_at_idx
  ON content_posts(client_id, archived_at)
  WHERE archived_at IS NOT NULL;
