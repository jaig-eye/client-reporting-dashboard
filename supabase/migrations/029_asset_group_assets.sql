-- Migration 029: Google Ads pMax asset group assets
-- Stores individual creative assets (images, headlines, descriptions, videos)
-- for Performance Max campaign asset groups.

CREATE TABLE IF NOT EXISTS google_ads_asset_group_assets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id    UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id)           ON DELETE CASCADE,
  campaign_id      TEXT NOT NULL,
  campaign_name    TEXT,
  asset_group_id   TEXT NOT NULL,
  asset_group_name TEXT,
  asset_id         TEXT NOT NULL,
  field_type       TEXT NOT NULL,   -- HEADLINE, DESCRIPTION, MARKETING_IMAGE, LOGO, YOUTUBE_VIDEO, etc.
  text_content     TEXT,            -- populated for text assets (HEADLINE, DESCRIPTION, BUSINESS_NAME, etc.)
  image_url        TEXT,            -- populated for image / logo assets
  video_id         TEXT,            -- YouTube video ID for video assets
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (connection_id, asset_group_id, asset_id, field_type)
);

CREATE INDEX IF NOT EXISTS idx_gads_aga_client_group
  ON google_ads_asset_group_assets(client_id, asset_group_id);

CREATE INDEX IF NOT EXISTS idx_gads_aga_connection
  ON google_ads_asset_group_assets(connection_id);
