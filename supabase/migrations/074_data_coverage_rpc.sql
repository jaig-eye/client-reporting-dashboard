-- Migration 074: Data coverage RPC for the client Advanced tab.
-- Returns one row per metric source showing date range and gap diagnostics.
-- Gap days = (max_date - min_date + 1) - days_with_data.

CREATE OR REPLACE FUNCTION get_client_data_coverage(p_client_id UUID)
RETURNS TABLE(
  source         TEXT,
  min_date       DATE,
  max_date       DATE,
  days_with_data BIGINT
) LANGUAGE SQL STABLE AS $$
  SELECT 'google_ads'::TEXT, MIN(date), MAX(date), COUNT(DISTINCT date)
    FROM google_ads_metrics WHERE client_id = $1
  UNION ALL
  SELECT 'meta_ads', MIN(date), MAX(date), COUNT(DISTINCT date)
    FROM meta_ads_metrics WHERE client_id = $1
  UNION ALL
  SELECT 'ga4', MIN(date), MAX(date), COUNT(DISTINCT date)
    FROM ga4_metrics WHERE client_id = $1
  UNION ALL
  SELECT 'gsc', MIN(date), MAX(date), COUNT(DISTINCT date)
    FROM gsc_metrics WHERE client_id = $1
  UNION ALL
  SELECT 'ahrefs', MIN(date), MAX(date), COUNT(DISTINCT date)
    FROM ahrefs_metrics WHERE client_id = $1
$$;
