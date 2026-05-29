ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS wp_publish_mode TEXT NOT NULL DEFAULT 'scheduled_draft'
  CHECK (wp_publish_mode IN ('scheduled_draft', 'draft_only'));
