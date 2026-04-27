-- Ad Fuel spend aggregation RPCs
--
-- These collapse campaign-level daily rows into per-client-per-day or
-- per-client totals at the database layer, so the Ad Fuel dashboard never
-- hits PostgREST's per-request row cap regardless of how many campaigns a
-- client runs.

-- Per-client per-day Google spend from a given floor date.
-- Returns (client_id, date, spend) matching SpendRow shape in the route.
CREATE OR REPLACE FUNCTION daily_google_spend_by_client(floor_date DATE)
RETURNS TABLE(client_id UUID, date DATE, spend NUMERIC)
LANGUAGE SQL STABLE AS $$
  SELECT g.client_id, g.date, SUM(g.spend)::NUMERIC AS spend
  FROM google_ads_metrics g
  WHERE g.date >= floor_date
  GROUP BY g.client_id, g.date
$$;

-- Same for Meta
CREATE OR REPLACE FUNCTION daily_meta_spend_by_client(floor_date DATE)
RETURNS TABLE(client_id UUID, date DATE, spend NUMERIC)
LANGUAGE SQL STABLE AS $$
  SELECT m.client_id, m.date, SUM(m.spend)::NUMERIC AS spend
  FROM meta_ads_metrics m
  WHERE m.date >= floor_date
  GROUP BY m.client_id, m.date
$$;

-- All-time Google spend per client from a cutoff date (for Lifetime Raw Balance).
CREATE OR REPLACE FUNCTION lifetime_google_spend_by_client(cutoff_date DATE)
RETURNS TABLE(client_id UUID, spend NUMERIC)
LANGUAGE SQL STABLE AS $$
  SELECT g.client_id, SUM(g.spend)::NUMERIC AS spend
  FROM google_ads_metrics g
  WHERE g.date >= cutoff_date
  GROUP BY g.client_id
$$;

-- Same for Meta
CREATE OR REPLACE FUNCTION lifetime_meta_spend_by_client(cutoff_date DATE)
RETURNS TABLE(client_id UUID, spend NUMERIC)
LANGUAGE SQL STABLE AS $$
  SELECT m.client_id, SUM(m.spend)::NUMERIC AS spend
  FROM meta_ads_metrics m
  WHERE m.date >= cutoff_date
  GROUP BY m.client_id
$$;
