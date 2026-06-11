-- Migration 147: Efficient per-adset budget lookup for ABO campaign detail page.
--
-- The campaign detail page previously queried meta_ads_ad_metrics with LIMIT 1000
-- to scan for the most recent non-null adset_daily_budget per adset. For campaigns
-- with many ads, that window could exclude budget-bearing rows for lower-volume
-- adsets (especially those synced before the adsets-pagination fix). This RPC uses
-- DISTINCT ON to return exactly one row per adset — O(adsets), not O(rows).

CREATE OR REPLACE FUNCTION get_adset_budgets_for_campaign(
  p_campaign_id TEXT,
  p_client_id   UUID,
  p_from_date   DATE DEFAULT NULL
)
RETURNS TABLE(
  adset_id           TEXT,
  adset_name         TEXT,
  ad_status          TEXT,
  adset_daily_budget NUMERIC
)
LANGUAGE SQL STABLE AS $$
  SELECT DISTINCT ON (adset_id)
    adset_id,
    adset_name,
    ad_status,
    adset_daily_budget
  FROM meta_ads_ad_metrics
  WHERE campaign_id = p_campaign_id
    AND client_id   = p_client_id
    AND adset_daily_budget IS NOT NULL
    AND (p_from_date IS NULL OR date >= p_from_date)
  ORDER BY adset_id, date DESC
$$;
