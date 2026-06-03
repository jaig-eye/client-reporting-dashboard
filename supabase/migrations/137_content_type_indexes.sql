-- Composite indexes for (client_id, content_type) filtering.
-- The 8 count queries in clients/[id]/page.tsx filter by both columns;
-- without these the DB scans the full client_id partition then re-filters.
CREATE INDEX IF NOT EXISTS idx_content_topics_client_type
  ON content_topics(client_id, content_type);

CREATE INDEX IF NOT EXISTS idx_content_posts_client_type
  ON content_posts(client_id, content_type);
