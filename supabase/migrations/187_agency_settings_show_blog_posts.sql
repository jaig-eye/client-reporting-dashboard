ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS show_blog_posts boolean NOT NULL DEFAULT false;
