-- Migration 067: Content Settings v3
-- Add sitemap_urls (multi-sitemap) and manual_link_urls (always-include links) to content_settings.
-- Extend content_topics status CHECK to include 'scheduled' (used by cron and late-approval flow).

ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS sitemap_urls     TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS manual_link_urls TEXT[] DEFAULT '{}';

-- Seed sitemap_urls from existing sitemap_url where not already set
UPDATE content_settings
SET sitemap_urls = ARRAY[sitemap_url]
WHERE sitemap_url IS NOT NULL
  AND sitemap_url != ''
  AND (sitemap_urls IS NULL OR sitemap_urls = '{}');

-- Extend content_topics status to include 'scheduled'
ALTER TABLE content_topics
  DROP CONSTRAINT IF EXISTS content_topics_status_check;

ALTER TABLE content_topics
  ADD CONSTRAINT content_topics_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'generating', 'generated', 'scheduled'));
