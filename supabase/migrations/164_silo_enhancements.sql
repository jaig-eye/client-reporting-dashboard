-- Migration 164: Content silo enhancements
-- Adds content_type, target_keyword, cluster_keywords, target_exists, priority to content_silos.
-- Also adds the append_silo_pending_link RPC for atomic JSONB array append.

ALTER TABLE content_silos
  ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'blog'
    CHECK (content_type IN ('blog', 'service_page', 'regular_page'));

ALTER TABLE content_silos
  ADD COLUMN IF NOT EXISTS target_keyword TEXT;

-- Per-element shape: { id, keyword, title?, status: 'planned'|'published', priority }
ALTER TABLE content_silos
  ADD COLUMN IF NOT EXISTS cluster_keywords JSONB NOT NULL DEFAULT '[]'::jsonb;

-- false = hub page not created yet; cron generates hub topic first
ALTER TABLE content_silos
  ADD COLUMN IF NOT EXISTS target_exists BOOLEAN NOT NULL DEFAULT true;

-- Lower = higher priority in cron auto-selection (25=High, 100=Medium, 175=Low)
ALTER TABLE content_silos
  ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 100;

CREATE INDEX IF NOT EXISTS idx_content_silos_priority
  ON content_silos(client_id, status, priority ASC)
  WHERE status = 'active';

-- Atomic JSONB array append — prevents race condition when two cluster posts
-- from the same silo are WP-pushed in the same cron batch.
CREATE OR REPLACE FUNCTION append_silo_pending_link(silo_id UUID, link JSONB)
RETURNS void LANGUAGE sql AS $$
  UPDATE content_silos
  SET pending_links = COALESCE(pending_links, '[]'::jsonb) || link
  WHERE id = silo_id;
$$;
