-- Migration 144: Fix spend RPC double-counting for Ad Fuel balance.
--
-- Two compounding issues caused Ad Fuel balances to appear inflated:
--
--   1. SUMMARY ROWS: Meta's sync writes an adset-level aggregate row per adset per day
--      in meta_ads_ad_metrics with ad_id = adset_id. That row's spend equals the sum of
--      all per-ad rows for that adset. Including it alongside the per-ad rows doubles
--      the spend for each adset.
--
--   2. MULTIPLE CONNECTIONS: A client with 2 connections to the same Meta ad account
--      has two rows for every (ad_id, date) pair — one per connection_id. The UNIQUE
--      constraint is (connection_id, ad_id, date), so duplicates are not prevented.
--      Both rows are summed → 2× spend per ad.
--
--   Combined effect: 2 connections × summary rows = up to 4× actual spend.
--   afLifetime = 4× rawSpend / (1 - cut) → balance = purchased - 4×actual = too low.
--   When the RPC itself fails, spend = 0 → balance = purchased (shows full amount).
--
-- Fix: deduplicate by (client_id, ad_id, date) and exclude summary rows.
-- Apply same dedup to Google for multiple-connection safety.

-- ── Meta: sum lifetime spend ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sum_meta_spend_by_client(
  from_date DATE,
  to_date   DATE DEFAULT NULL
)
RETURNS TABLE(client_id UUID, spend NUMERIC)
LANGUAGE SQL STABLE AS $$
  SELECT client_id, SUM(spend)::NUMERIC AS spend
  FROM (
    -- Deduplicate: take one row per (client_id, ad_id, date), ignoring connection_id.
    -- This handles clients with multiple connections to the same Meta ad account.
    SELECT DISTINCT ON (m.client_id, m.ad_id, m.date)
      m.client_id,
      m.spend
    FROM meta_ads_ad_metrics m
    WHERE m.date >= from_date
      AND (to_date IS NULL OR m.date <= to_date)
      -- Exclude adset-level summary rows (ad_id = adset_id). These rows contain the
      -- total adset spend and are already captured in the individual per-ad rows.
      AND (m.adset_id IS NULL OR m.ad_id != m.adset_id)
    ORDER BY m.client_id, m.ad_id, m.date
  ) deduped
  GROUP BY client_id
$$;

-- ── Meta: daily spend by client ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION daily_meta_spend_by_client(floor_date DATE)
RETURNS TABLE(client_id UUID, date DATE, spend NUMERIC)
LANGUAGE SQL STABLE AS $$
  SELECT client_id, date, SUM(spend)::NUMERIC AS spend
  FROM (
    SELECT DISTINCT ON (m.client_id, m.ad_id, m.date)
      m.client_id,
      m.date,
      m.spend
    FROM meta_ads_ad_metrics m
    WHERE m.date >= floor_date
      AND (m.adset_id IS NULL OR m.ad_id != m.adset_id)
    ORDER BY m.client_id, m.ad_id, m.date
  ) deduped
  GROUP BY client_id, date
$$;

-- ── Google: sum lifetime spend ────────────────────────────────────────────────
-- google_ads_metrics is campaign-level (no summary row issue), but still needs
-- deduplication for clients with multiple connections to the same Google account.

CREATE OR REPLACE FUNCTION sum_google_spend_by_client(
  from_date DATE,
  to_date   DATE DEFAULT NULL
)
RETURNS TABLE(client_id UUID, spend NUMERIC)
LANGUAGE SQL STABLE AS $$
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
