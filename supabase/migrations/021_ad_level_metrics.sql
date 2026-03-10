-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 021: Ad-level metrics tables
-- Run after: 020_ad_fuel.sql
--
-- Stores ad-group/ad level data for campaign drill-down on the dashboard.
-- Synced after campaign-level metrics during each sync job.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Google Ads: ad-group → ad level ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_ads_ad_metrics (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id    UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id)            ON DELETE CASCADE,

  -- Hierarchy
  campaign_id      TEXT NOT NULL,
  campaign_name    TEXT NOT NULL DEFAULT '',
  ad_group_id      TEXT NOT NULL,
  ad_group_name    TEXT NOT NULL DEFAULT '',
  ad_id            TEXT NOT NULL,
  ad_name          TEXT          DEFAULT '',
  ad_type          TEXT,                       -- EXPANDED_TEXT_AD, RESPONSIVE_SEARCH_AD, etc.

  date             DATE NOT NULL,

  -- Raw platform metrics
  cost_micros      BIGINT  NOT NULL DEFAULT 0,
  spend            NUMERIC(12,2) NOT NULL DEFAULT 0,
  impressions      INTEGER NOT NULL DEFAULT 0,
  clicks           INTEGER NOT NULL DEFAULT 0,
  conversions      NUMERIC(10,4) NOT NULL DEFAULT 0,
  conversions_value NUMERIC(12,2) NOT NULL DEFAULT 0,

  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (connection_id, ad_id, date)
);

CREATE INDEX IF NOT EXISTS google_ads_ad_metrics_campaign_idx
  ON google_ads_ad_metrics (connection_id, campaign_id, date);

-- ── Meta Ads: adset → ad level ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meta_ads_ad_metrics (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id    UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id)            ON DELETE CASCADE,

  -- Hierarchy
  campaign_id      TEXT NOT NULL,
  campaign_name    TEXT NOT NULL DEFAULT '',
  adset_id         TEXT,
  adset_name       TEXT          DEFAULT '',
  ad_id            TEXT NOT NULL,
  ad_name          TEXT          DEFAULT '',
  thumbnail_url    TEXT,                       -- From ad creative, fetched at sync time

  date             DATE NOT NULL,

  -- Raw platform metrics
  spend            NUMERIC(12,2) NOT NULL DEFAULT 0,
  impressions      INTEGER NOT NULL DEFAULT 0,
  clicks           INTEGER NOT NULL DEFAULT 0,
  reach            INTEGER NOT NULL DEFAULT 0,

  -- JSONB for live conversion remapping (same pattern as campaign-level)
  actions          JSONB NOT NULL DEFAULT '[]',
  action_values    JSONB NOT NULL DEFAULT '[]',

  -- Derived at sync time (approximate)
  conversions      NUMERIC(10,4) NOT NULL DEFAULT 0,
  conversion_value NUMERIC(12,2) NOT NULL DEFAULT 0,

  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (connection_id, ad_id, date)
);

CREATE INDEX IF NOT EXISTS meta_ads_ad_metrics_campaign_idx
  ON meta_ads_ad_metrics (connection_id, campaign_id, date);

-- Trigger updated_at on both tables
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at') THEN
    CREATE TRIGGER google_ads_ad_metrics_updated_at
      BEFORE UPDATE ON google_ads_ad_metrics
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();

    CREATE TRIGGER meta_ads_ad_metrics_updated_at
      BEFORE UPDATE ON meta_ads_ad_metrics
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
