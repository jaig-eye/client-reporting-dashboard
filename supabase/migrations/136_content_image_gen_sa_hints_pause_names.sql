-- content_settings: image generation toggle + prompt
ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS content_image_generation BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS content_image_prompt TEXT;

-- service_area_settings: optional manual location hints for discover
ALTER TABLE service_area_settings
  ADD COLUMN IF NOT EXISTS manual_hint_areas JSONB;
-- format: [{ "city": "Palm Bay", "state": "FL" }, ...]

-- ad_pause_log: store campaign names alongside IDs for Discord messages
ALTER TABLE ad_pause_log
  ADD COLUMN IF NOT EXISTS paused_campaign_names JSONB;
-- format: { "google": ["Campaign A", "Campaign B"], "meta": ["Campaign C"] }
