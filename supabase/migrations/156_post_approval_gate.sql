-- Migration 156: Add admin approval gate to content_posts
-- Posts must be explicitly approved by an admin before the cron auto-pushes to WordPress.
-- admin_approved_at IS NOT NULL ↔ status = 'approved' (the cron filters on status).

ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS admin_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_approved_by TEXT;

-- Partial index speeds up the cron query: approved posts due within the next 2 days
CREATE INDEX IF NOT EXISTS idx_content_posts_approved_due
  ON content_posts(target_publish_date)
  WHERE status = 'approved';

-- Also index for the list view query: unapproved posts ordered by deadline
CREATE INDEX IF NOT EXISTS idx_content_posts_review_queue
  ON content_posts(target_publish_date ASC, client_id)
  WHERE status IN ('for_review', 'pending');
