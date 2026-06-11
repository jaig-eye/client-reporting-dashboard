-- Migration 148: Add default_author_id to service_area_settings.
-- Mirrors the same column in content_settings so SA pages can have a
-- dedicated default WP author independent of the blog default.
ALTER TABLE service_area_settings ADD COLUMN IF NOT EXISTS default_author_id INT;
