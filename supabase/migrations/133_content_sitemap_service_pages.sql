ALTER TABLE content_sitemap_pages
  ADD COLUMN IF NOT EXISTS is_service_page BOOLEAN DEFAULT false;
