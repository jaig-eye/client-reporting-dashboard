-- Add BigCommerce blog post tracking columns + featured image URL.
ALTER TABLE content_posts ADD COLUMN IF NOT EXISTS bc_post_id    BIGINT;
ALTER TABLE content_posts ADD COLUMN IF NOT EXISTS bc_store_hash TEXT;
ALTER TABLE content_posts ADD COLUMN IF NOT EXISTS featured_image_url TEXT;
