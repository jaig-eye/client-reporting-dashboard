-- Per-page-type topic guidelines and auto_generate toggles for Service Pages and Regular Pages.
-- These allow different content briefs without duplicating schedule/frequency settings.
ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS service_page_topic_guidelines TEXT,
  ADD COLUMN IF NOT EXISTS regular_page_topic_guidelines TEXT,
  ADD COLUMN IF NOT EXISTS service_page_auto_generate BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS regular_page_auto_generate BOOLEAN NOT NULL DEFAULT false;
