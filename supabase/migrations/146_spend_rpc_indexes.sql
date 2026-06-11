-- Migration 146: Speed up spend RPCs (indexes + timeout) + admin dashboard aggregation RPC.
--
-- Fix A: Covering indexes for sum_meta_spend_by_client and sum_google_spend_by_client.
--   Both RPCs use DISTINCT ON (client_id, X, date). The existing unique indexes are keyed
--   on (connection_id, X, date) — the wrong leading column for these queries.
--   New indexes on (client_id, ad_id/campaign_id, date) allow index-only scans.
--
-- Fix A+: Re-create sum_meta_spend_by_client and sum_google_spend_by_client with
--   SET statement_timeout = '60s' so they raise 57014 only after 60 s instead of the
--   default 10 s. Indexes should make this unnecessary in practice, but it's a safety net.
--
-- Fix B: get_google_metrics_by_client — pre-aggregated per-client Google totals used by
--   the admin clients tab to avoid fetching millions of raw rows to the JS layer.

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_meta_ad_metrics_client_ad_date
  ON meta_ads_ad_metrics (client_id, ad_id, date);

CREATE INDEX IF NOT EXISTS idx_google_metrics_client_campaign_date
  ON google_ads_metrics (client_id, campaign_id, date);

-- Index for admin dashboard Meta query (client_id, date filter)
CREATE INDEX IF NOT EXISTS idx_meta_metrics_client_date
  ON meta_ads_metrics (client_id, date);

-- ── sum_meta_spend_by_client (with 60s timeout) ──────────────────────────────

CREATE OR REPLACE FUNCTION sum_meta_spend_by_client(
  from_date DATE,
  to_date   DATE DEFAULT NULL
)
RETURNS TABLE(client_id UUID, spend NUMERIC)
LANGUAGE SQL STABLE
SET statement_timeout = '60000'
AS $$
  SELECT client_id, SUM(spend)::NUMERIC AS spend
  FROM (
    SELECT DISTINCT ON (m.client_id, m.ad_id, m.date)
      m.client_id,
      m.spend
    FROM meta_ads_ad_metrics m
    WHERE m.date >= from_date
      AND (to_date IS NULL OR m.date <= to_date)
      AND (m.adset_id IS NULL OR m.ad_id != m.adset_id)
    ORDER BY m.client_id, m.ad_id, m.date
  ) deduped
  GROUP BY client_id
$$;

-- ── sum_google_spend_by_client (with 60s timeout) ────────────────────────────

CREATE OR REPLACE FUNCTION sum_google_spend_by_client(
  from_date DATE,
  to_date   DATE DEFAULT NULL
)
RETURNS TABLE(client_id UUID, spend NUMERIC)
LANGUAGE SQL STABLE
SET statement_timeout = '60000'
AS $$
  SELECT client_id, SUM(spend)::NUMERIC AS spend
  FROM (
    SELECT DISTINCT ON (g.client_id, g.campaign_id, g.date)
      g.client_id,
      g.spend
    FROM google_ads_metrics g
    WHERE g.date >= from_date
      AND (to_date IS NULL OR g.date <= to_date)
    ORDER BY g.client_id, g.campaign_id, g.date
  ) deduped
  GROUP BY client_id
$$;

-- ── get_google_metrics_by_client ─────────────────────────────────────────────
-- Returns one pre-aggregated row per client for Google Ads metrics.
-- Used by the admin clients tab to replace the raw google_ads_metrics query,
-- avoiding transfer of potentially hundreds of thousands of rows to the JS layer.

CREATE OR REPLACE FUNCTION get_google_metrics_by_client(
  from_date DATE,
  to_date   DATE DEFAULT NULL
)
RETURNS TABLE(
  client_id        UUID,
  spend            NUMERIC,
  clicks           BIGINT,
  impressions      BIGINT,
  conversions      NUMERIC,
  conversions_value NUMERIC
)
LANGUAGE SQL STABLE
SET statement_timeout = '60000'
AS $$
  SELECT
    client_id,
    SUM(spend)::NUMERIC              AS spend,
    SUM(clicks)::BIGINT              AS clicks,
    SUM(impressions)::BIGINT         AS impressions,
    SUM(conversions)::NUMERIC        AS conversions,
    SUM(conversions_value)::NUMERIC  AS conversions_value
  FROM (
    SELECT DISTINCT ON (g.client_id, g.campaign_id, g.date)
      g.client_id, g.spend, g.clicks, g.impressions, g.conversions, g.conversions_value
    FROM google_ads_metrics g
    WHERE g.date >= from_date
      AND (to_date IS NULL OR g.date <= to_date)
    ORDER BY g.client_id, g.campaign_id, g.date
  ) deduped
  GROUP BY client_id
$$;
