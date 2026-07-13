-- Add WordPress category IDs to content posts and schedule settings.
-- Uses IF NOT EXISTS so it's safe to apply to any DB state.

ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS wp_category_ids INT[] DEFAULT NULL;

ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS default_category_ids INT[] DEFAULT NULL;
