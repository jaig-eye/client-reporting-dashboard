-- Content silos: pillar/hub page definitions for topical authority
-- Each silo defines a hub page + central entity that cluster posts link back to.
-- Blog silos are created manually by admins; SA silos are auto-upserted per service.

CREATE TABLE content_silos (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id      UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL,
  hub_page_url   TEXT,
  hub_page_title TEXT,
  central_entity TEXT,
  description    TEXT,
  section        TEXT        DEFAULT 'core'   CHECK (section IN ('core', 'outer')),
  status         TEXT        DEFAULT 'active' CHECK (status IN ('active', 'planned', 'archived')),
  -- Audit trail of cluster links pushed to the hub page
  pending_links  JSONB       DEFAULT '[]'::jsonb,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, name)
);

ALTER TABLE content_topics ADD COLUMN IF NOT EXISTS silo_id UUID REFERENCES content_silos(id) ON DELETE SET NULL;
ALTER TABLE content_posts  ADD COLUMN IF NOT EXISTS silo_id UUID REFERENCES content_silos(id) ON DELETE SET NULL;

-- Index for fetching all cluster posts/topics in a silo efficiently
CREATE INDEX IF NOT EXISTS idx_content_topics_silo_id ON content_topics(silo_id) WHERE silo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_posts_silo_id  ON content_posts(silo_id)  WHERE silo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_silos_client   ON content_silos(client_id);
