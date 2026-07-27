-- 177: BigCommerce author field — configurable author name for BC blog posts
ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS bc_author TEXT;
