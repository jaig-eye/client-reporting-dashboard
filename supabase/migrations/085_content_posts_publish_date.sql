-- 085_content_posts_publish_date
-- Add target_publish_date and wp_site_url to content_posts so we can display
-- the scheduled publish date and construct a WordPress admin edit link without
-- an additional join to content_topics.
ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS target_publish_date DATE,
  ADD COLUMN IF NOT EXISTS wp_site_url         TEXT;
