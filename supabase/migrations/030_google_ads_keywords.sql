-- Migration 030: Google Ads keyword-level metrics
-- Stores daily keyword performance for Search campaigns.
-- Unique on (connection_id, keyword_id, date) so incremental syncs upsert cleanly.

CREATE TABLE IF NOT EXISTS google_ads_keywords (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id     UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id         UUID NOT NULL REFERENCES clients(id)           ON DELETE CASCADE,
  campaign_id       TEXT NOT NULL,
  campaign_name     TEXT,
  ad_group_id       TEXT NOT NULL,
  ad_group_name     TEXT,
  keyword_id        TEXT NOT NULL,
  keyword_text      TEXT NOT NULL,
  match_type        TEXT,           -- BROAD | PHRASE | EXACT
  keyword_status    TEXT,
  spend             NUMERIC(12,6)  NOT NULL DEFAULT 0,
  impressions       INT            NOT NULL DEFAULT 0,
  clicks            INT            NOT NULL DEFAULT 0,
  conversions       NUMERIC(10,2)  NOT NULL DEFAULT 0,
  conversions_value NUMERIC(12,2)  NOT NULL DEFAULT 0,
  date              DATE           NOT NULL,
  synced_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  UNIQUE (connection_id, keyword_id, date)
);

CREATE INDEX IF NOT EXISTS idx_gads_kw_client_campaign
  ON google_ads_keywords(client_id, campaign_id, ad_group_id, date);

CREATE INDEX IF NOT EXISTS idx_gads_kw_connection
  ON google_ads_keywords(connection_id);
