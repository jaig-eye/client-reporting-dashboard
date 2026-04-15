-- Migration 048: Content SEO fields
-- Adds phone_number to content_settings for injection into AI generation prompts.
-- Adds seo_title and suggested_tags to content_posts for Rank Math SEO integration.

ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS phone_number TEXT;

ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS seo_title TEXT,
  ADD COLUMN IF NOT EXISTS suggested_tags TEXT[];
