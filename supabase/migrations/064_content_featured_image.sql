-- Migration 064: Add featured_image_url to content_topics and content_posts
-- Allows admins to attach a featured image during the topic review/approval step,
-- which is then forwarded to WordPress on publish.
ALTER TABLE content_topics ADD COLUMN IF NOT EXISTS featured_image_url TEXT;
ALTER TABLE content_posts  ADD COLUMN IF NOT EXISTS featured_image_url TEXT;
