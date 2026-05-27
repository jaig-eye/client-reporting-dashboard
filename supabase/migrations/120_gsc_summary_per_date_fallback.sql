-- Migration 120: Fix get_gsc_summary per-date fallback logic.
--
-- Previous versions used a range-level NOT EXISTS check:
--   AND NOT EXISTS (SELECT 1 FROM gsc_daily_totals WHERE ... AND date >= p_date_from AND date <= p_date_to)
--
-- This caused two bugs:
--   1. For partial date ranges (some dates in aggregate tables, some only in gsc_metrics),
--      the fallback branch was skipped entirely — data for historic dates went missing.
--   2. For large historic ranges where gsc_metrics had millions of rows (3D cross-product),
--      the fallback queries scanned the full table and triggered Supabase's statement timeout,
--      producing "Connection closed" errors in the browser.
--
-- Fix: switch to per-date exclusion using
--   AND date NOT IN (SELECT DISTINCT date FROM <aggregate_table> WHERE ...)
-- This correctly handles partial ranges and caps the gsc_metrics scan to only
-- the dates not already covered by the aggregate tables.
-- A LIMIT 50000 guard on the gsc_metrics fallback prevents timeout on very large
-- historic datasets (position distribution is approximate anyway).

DROP FUNCTION IF EXISTS get_gsc_summary(UUID, UUID, DATE, DATE, INT);

CREATE OR REPLACE FUNCTION get_gsc_summary(
  p_client_id     UUID,
  p_connection_id UUID,
  p_date_from     DATE,
  p_date_to       DATE,
  p_top_n         INT DEFAULT 25
)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_totals  JSON;
  v_queries JSON;
  v_pages   JSON;
  v_daily   JSON;
  v_dist    JSON;
BEGIN

  -- ── Period totals ──────────────────────────────────────────────────────────
  -- Per-date: prefer gsc_daily_totals; fall back to gsc_metrics for dates
  -- not yet in the aggregate table.
  SELECT json_build_object(
    'clicks',      COALESCE(SUM(clicks), 0),
    'impressions', COALESCE(SUM(impressions), 0),
    'ctr',         CASE WHEN SUM(impressions) > 0 THEN SUM(clicks::float) / SUM(impressions) ELSE 0 END,
    'position',    CASE WHEN SUM(impressions) > 0 THEN SUM(position * impressions) / SUM(impressions) ELSE 0 END
  ) INTO v_totals
  FROM (
    SELECT clicks, impressions, position
    FROM gsc_daily_totals
    WHERE client_id     = p_client_id
      AND connection_id = p_connection_id
      AND date >= p_date_from AND date <= p_date_to
    UNION ALL
    SELECT SUM(clicks)::int, SUM(impressions)::int,
           CASE WHEN SUM(impressions) > 0 THEN SUM(position * impressions) / SUM(impressions) ELSE 0 END
    FROM gsc_metrics
    WHERE client_id     = p_client_id
      AND connection_id = p_connection_id
      AND date >= p_date_from AND date <= p_date_to
      AND date NOT IN (
        SELECT DISTINCT date FROM gsc_daily_totals
        WHERE client_id     = p_client_id
          AND connection_id = p_connection_id
          AND date >= p_date_from AND date <= p_date_to
      )
    GROUP BY date
  ) t;

  -- ── Top queries ────────────────────────────────────────────────────────────
  SELECT json_agg(q) INTO v_queries FROM (
    SELECT
      query,
      SUM(clicks)::int      AS clicks,
      SUM(impressions)::int AS impressions,
      CASE WHEN SUM(impressions) > 0 THEN SUM(clicks::float) / SUM(impressions) ELSE 0 END AS ctr,
      CASE WHEN SUM(impressions) > 0 THEN SUM(position * impressions) / SUM(impressions) ELSE 0 END AS position
    FROM (
      SELECT query, clicks, impressions, position
      FROM gsc_query_totals
      WHERE client_id     = p_client_id
        AND connection_id = p_connection_id
        AND date >= p_date_from AND date <= p_date_to
        AND query IS NOT NULL
      UNION ALL
      SELECT query, clicks, impressions, position
      FROM gsc_metrics
      WHERE client_id     = p_client_id
        AND connection_id = p_connection_id
        AND date >= p_date_from AND date <= p_date_to
        AND query IS NOT NULL
        AND date NOT IN (
          SELECT DISTINCT date FROM gsc_query_totals
          WHERE client_id     = p_client_id
            AND connection_id = p_connection_id
            AND date >= p_date_from AND date <= p_date_to
        )
    ) src
    GROUP BY query
    ORDER BY SUM(clicks) DESC
    LIMIT p_top_n
  ) q;

  -- ── Top pages ──────────────────────────────────────────────────────────────
  SELECT json_agg(p) INTO v_pages FROM (
    SELECT
      page,
      SUM(clicks)::int      AS clicks,
      SUM(impressions)::int AS impressions,
      CASE WHEN SUM(impressions) > 0 THEN SUM(clicks::float) / SUM(impressions) ELSE 0 END AS ctr,
      CASE WHEN SUM(impressions) > 0 THEN SUM(position * impressions) / SUM(impressions) ELSE 0 END AS position
    FROM (
      SELECT page, clicks, impressions, position
      FROM gsc_page_totals
      WHERE client_id     = p_client_id
        AND connection_id = p_connection_id
        AND date >= p_date_from AND date <= p_date_to
        AND page IS NOT NULL
      UNION ALL
      SELECT page, clicks, impressions, position
      FROM gsc_metrics
      WHERE client_id     = p_client_id
        AND connection_id = p_connection_id
        AND date >= p_date_from AND date <= p_date_to
        AND page IS NOT NULL
        AND date NOT IN (
          SELECT DISTINCT date FROM gsc_page_totals
          WHERE client_id     = p_client_id
            AND connection_id = p_connection_id
            AND date >= p_date_from AND date <= p_date_to
        )
    ) src
    GROUP BY page
    ORDER BY SUM(clicks) DESC
    LIMIT p_top_n
  ) p;

  -- ── Daily trend ────────────────────────────────────────────────────────────
  SELECT json_agg(d ORDER BY d.date) INTO v_daily FROM (
    SELECT date::text AS date, clicks, impressions
    FROM gsc_daily_totals
    WHERE client_id     = p_client_id
      AND connection_id = p_connection_id
      AND date >= p_date_from AND date <= p_date_to
    UNION ALL
    SELECT date::text, SUM(clicks)::int, SUM(impressions)::int
    FROM gsc_metrics
    WHERE client_id     = p_client_id
      AND connection_id = p_connection_id
      AND date >= p_date_from AND date <= p_date_to
      AND date NOT IN (
        SELECT DISTINCT date FROM gsc_daily_totals
        WHERE client_id     = p_client_id
          AND connection_id = p_connection_id
          AND date >= p_date_from AND date <= p_date_to
      )
    GROUP BY date
  ) d;

  -- ── Position distribution ──────────────────────────────────────────────────
  -- Uses gsc_query_totals per-date; falls back to gsc_metrics for uncovered dates.
  -- LIMIT 50000 on the fallback caps scan cost on large historic datasets.
  SELECT json_build_object(
    'top3',   COALESCE(COUNT(*) FILTER (WHERE avg_pos <= 3),                    0),
    'page1',  COALESCE(COUNT(*) FILTER (WHERE avg_pos > 3  AND avg_pos <= 10),  0),
    'page2',  COALESCE(COUNT(*) FILTER (WHERE avg_pos > 10 AND avg_pos <= 20),  0),
    'beyond', COALESCE(COUNT(*) FILTER (WHERE avg_pos > 20),                    0)
  ) INTO v_dist
  FROM (
    SELECT
      CASE WHEN SUM(impressions) > 0
           THEN SUM(position * impressions) / SUM(impressions) ELSE 0 END AS avg_pos
    FROM (
      SELECT query, position, impressions
      FROM gsc_query_totals
      WHERE client_id     = p_client_id
        AND connection_id = p_connection_id
        AND date >= p_date_from AND date <= p_date_to
        AND query IS NOT NULL
      UNION ALL
      SELECT query, position, impressions
      FROM (
        SELECT query, position, impressions
        FROM gsc_metrics
        WHERE client_id     = p_client_id
          AND connection_id = p_connection_id
          AND date >= p_date_from AND date <= p_date_to
          AND query IS NOT NULL
          AND date NOT IN (
            SELECT DISTINCT date FROM gsc_query_totals
            WHERE client_id     = p_client_id
              AND connection_id = p_connection_id
              AND date >= p_date_from AND date <= p_date_to
          )
        LIMIT 50000
      ) capped
    ) src
    GROUP BY query
  ) q;

  RETURN json_build_object(
    'totals',       COALESCE(v_totals,  '{"clicks":0,"impressions":0,"ctr":0,"position":0}'::json),
    'queries',      COALESCE(v_queries, '[]'::json),
    'pages',        COALESCE(v_pages,   '[]'::json),
    'daily',        COALESCE(v_daily,   '[]'::json),
    'distribution', COALESCE(v_dist,    '{"top3":0,"page1":0,"page2":0,"beyond":0}'::json)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_gsc_summary(UUID, UUID, DATE, DATE, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_gsc_summary(UUID, UUID, DATE, DATE, INT) TO service_role;
