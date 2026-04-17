-- Migration 059: get_gsc_summary RPC
-- Aggregates GSC metrics in Postgres to avoid large row fetches timing out
-- for clients with many rows (90-day range can be thousands of rows).

CREATE OR REPLACE FUNCTION get_gsc_summary(
  p_client_id UUID,
  p_date_from DATE,
  p_date_to   DATE,
  p_top_n     INT DEFAULT 25
)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_totals  JSON;
  v_queries JSON;
  v_pages   JSON;
BEGIN
  -- Overall period totals (impression-weighted position)
  SELECT json_build_object(
    'clicks',      SUM(clicks),
    'impressions', SUM(impressions),
    'ctr',         CASE WHEN SUM(impressions) > 0
                     THEN SUM(clicks::float) / SUM(impressions) ELSE 0 END,
    'position',    CASE WHEN SUM(impressions) > 0
                     THEN SUM(position * impressions) / SUM(impressions) ELSE 0 END
  ) INTO v_totals
  FROM gsc_metrics
  WHERE client_id = p_client_id
    AND date >= p_date_from AND date <= p_date_to;

  -- Top queries aggregated across dates
  SELECT json_agg(q)
  INTO v_queries
  FROM (
    SELECT
      query,
      SUM(clicks)::int                                                               AS clicks,
      SUM(impressions)::int                                                          AS impressions,
      CASE WHEN SUM(impressions) > 0
           THEN SUM(clicks::float) / SUM(impressions) ELSE 0 END                    AS ctr,
      CASE WHEN SUM(impressions) > 0
           THEN SUM(position * impressions) / SUM(impressions) ELSE 0 END           AS position
    FROM gsc_metrics
    WHERE client_id = p_client_id
      AND date >= p_date_from AND date <= p_date_to
      AND query IS NOT NULL
    GROUP BY query
    ORDER BY clicks DESC
    LIMIT p_top_n
  ) q;

  -- Top pages aggregated (excluding query-string / UTM URLs)
  SELECT json_agg(p)
  INTO v_pages
  FROM (
    SELECT
      page,
      SUM(clicks)::int                                                               AS clicks,
      SUM(impressions)::int                                                          AS impressions,
      CASE WHEN SUM(impressions) > 0
           THEN SUM(clicks::float) / SUM(impressions) ELSE 0 END                    AS ctr,
      CASE WHEN SUM(impressions) > 0
           THEN SUM(position * impressions) / SUM(impressions) ELSE 0 END           AS position
    FROM gsc_metrics
    WHERE client_id = p_client_id
      AND date >= p_date_from AND date <= p_date_to
      AND page IS NOT NULL
      AND page NOT LIKE '%?%'
    GROUP BY page
    ORDER BY clicks DESC
    LIMIT p_top_n
  ) p;

  RETURN json_build_object(
    'totals',  COALESCE(v_totals,  '{}'::json),
    'queries', COALESCE(v_queries, '[]'::json),
    'pages',   COALESCE(v_pages,   '[]'::json)
  );
END;
$$;

-- Grant execute to authenticated users (Supabase RLS context)
GRANT EXECUTE ON FUNCTION get_gsc_summary(UUID, DATE, DATE, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_gsc_summary(UUID, DATE, DATE, INT) TO service_role;
