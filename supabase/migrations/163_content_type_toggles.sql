-- Per-type enable flags (blog + service_area already work; these are opt-in)
ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS generate_service_pages  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS generate_regular_pages  BOOLEAN NOT NULL DEFAULT false;
