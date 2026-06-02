-- Migration 135: Switch Meta spend RPCs to ad-level table as source of truth.
--
-- meta_ads_metrics (campaign-level) can lag or diverge from actual spend data.
-- meta_ads_ad_metrics is always accurate — it's the same source used by the
-- dashboard UI for campaign costs, CTR, and all other Meta metrics.
--
-- Affects: Ad Fuel page (Facebook Raw Spend), auto-pause cron, ad fuel alert
-- crons, budget alert crons, GHL widget, admin dashboard — all via RPC name.

CREATE OR REPLACE FUNCTION daily_meta_spend_by_client(floor_date DATE)
RETURNS TABLE(client_id UUID, date DATE, spend NUMERIC)
LANGUAGE SQL STABLE AS $$
  SELECT m.client_id, m.date, SUM(m.spend)::NUMERIC AS spend
  FROM meta_ads_ad_metrics m
  WHERE m.date >= floor_date
  GROUP BY m.client_id, m.date
$$;

CREATE OR REPLACE FUNCTION sum_meta_spend_by_client(
  from_date DATE,
  to_date   DATE DEFAULT NULL
)
RETURNS TABLE(client_id UUID, spend NUMERIC)
LANGUAGE SQL STABLE AS $$
  SELECT m.client_id, SUM(m.spend)::NUMERIC AS spend
  FROM meta_ads_ad_metrics m
  WHERE m.date >= from_date
    AND (to_date IS NULL OR m.date <= to_date)
  GROUP BY m.client_id
$$;
