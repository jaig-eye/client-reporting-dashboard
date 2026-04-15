-- Migration 049: Content Topics workflow + agency_settings notification fields
-- Adds content_topics table for AI-driven topic planning with scheduled publish dates.
-- Also adds notification and overview_columns fields to agency_settings.

-- ── content_topics ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_topics (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  topic                TEXT        NOT NULL,
  rationale            TEXT,                         -- why this topic / which GSC gap it fills
  target_keyword       TEXT,
  status               TEXT        NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'approved', 'rejected', 'generating', 'generated')),
  target_publish_date  DATE,                         -- set by admin when approving
  generate_by_date     DATE GENERATED ALWAYS AS (target_publish_date - INTERVAL '7 days') STORED,
  post_id              UUID        REFERENCES content_posts(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_topics_client_id_idx ON content_topics(client_id);
CREATE INDEX IF NOT EXISTS content_topics_status_idx    ON content_topics(status);

-- ── content_posts: add scheduled publish fields ───────────────────────────────
ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS scheduled_publish_date DATE,
  ADD COLUMN IF NOT EXISTS auto_publish            BOOLEAN NOT NULL DEFAULT false;

-- ── agency_settings: notification + overview columns ─────────────────────────
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS notification_email      TEXT,
  ADD COLUMN IF NOT EXISTS notify_topics_created   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_post_generated   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_approval_needed  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS overview_columns        JSONB;
