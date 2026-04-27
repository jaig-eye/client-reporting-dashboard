-- Migration 073: Per-client spend sum RPCs for Ad Fuel lifetime calculations.
--
-- These return ONE row per client (not per campaign per day), so the result
-- set is always n_clients rows regardless of data volume. No row cap possible.
--
-- Used for lifetime and date-filter totals in the Ad Fuel dashboard.
-- The daily_* RPCs from migration 071 are still used for billing-cycle
-- per-day filtering (short 65-day window, manageable row count).

CREATE OR REPLACE FUNCTION sum_google_spend_by_client(
  from_date DATE,
  to_date   DATE DEFAULT NULL
)
RETURNS TABLE(client_id UUID, spend NUMERIC)
LANGUAGE SQL STABLE AS $$
  SELECT g.client_id, SUM(g.spend)::NUMERIC AS spend
  FROM google_ads_metrics g
  WHERE g.date >= from_date
    AND (to_date IS NULL OR g.date <= to_date)
  GROUP BY g.client_id
$$;

CREATE OR REPLACE FUNCTION sum_meta_spend_by_client(
  from_date DATE,
  to_date   DATE DEFAULT NULL
)
RETURNS TABLE(client_id UUID, spend NUMERIC)
LANGUAGE SQL STABLE AS $$
  SELECT m.client_id, SUM(m.spend)::NUMERIC AS spend
  FROM meta_ads_metrics m
  WHERE m.date >= from_date
    AND (to_date IS NULL OR m.date <= to_date)
  GROUP BY m.client_id
$$;
