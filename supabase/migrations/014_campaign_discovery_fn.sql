-- 014_campaign_discovery_fn.sql
-- SQL function for fast DISTINCT campaign discovery.
-- Without this the JS client had to fetch thousands of metric rows and
-- deduplicate in memory, hitting Supabase's default 1 000-row cap.

CREATE OR REPLACE FUNCTION get_client_campaigns(p_client_id UUID)
RETURNS TABLE(campaign_id TEXT, campaign_name TEXT, platform TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (platform, campaign_id)
    campaign_id,
    campaign_name,
    platform
  FROM campaign_metrics
  WHERE client_id = p_client_id
  ORDER BY platform, campaign_id, date DESC;
$$;
