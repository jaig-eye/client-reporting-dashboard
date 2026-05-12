-- Per-client auto-approval toggles (off by default, opt-in per client)
ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS auto_approve_topics BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_push_posts     BOOLEAN NOT NULL DEFAULT false;

-- Audit trail: when was this row auto-actioned?
ALTER TABLE content_topics
  ADD COLUMN IF NOT EXISTS auto_approved_at TIMESTAMPTZ;

ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS auto_pushed_at TIMESTAMPTZ;
