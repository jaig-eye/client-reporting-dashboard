CREATE OR REPLACE FUNCTION latest_campaign_budget_by_client()
RETURNS TABLE(client_id UUID, google_daily_budget NUMERIC, meta_daily_budget NUMERIC)
LANGUAGE SQL STABLE AS $$
  SELECT c.id,
    COALESCE((
      SELECT SUM(m.daily_budget)
      FROM google_ads_metrics m
      WHERE m.client_id = c.id
        AND m.date = (SELECT MAX(d.date) FROM google_ads_metrics d WHERE d.client_id = c.id)
    ), 0),
    COALESCE((
      SELECT SUM(m.daily_budget)
      FROM meta_ads_metrics m
      WHERE m.client_id = c.id
        AND m.date = (SELECT MAX(d.date) FROM meta_ads_metrics d WHERE d.client_id = c.id)
    ), 0)
  FROM clients c
$$;
