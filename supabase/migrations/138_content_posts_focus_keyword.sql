-- Add focus_keyword to content_posts (used by service area page generation)
ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS focus_keyword TEXT;
