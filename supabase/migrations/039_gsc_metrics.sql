-- 039_gsc_metrics.sql
-- Google Search Console daily performance metrics.
-- Stores search analytics data per query/page/country combination.
-- NULL query/page rows represent aggregate totals for the date.
-- Enables top queries, top pages, and overall click/impression trend views.

CREATE TABLE IF NOT EXISTS gsc_metrics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  query         TEXT,           -- search query string (NULL = date-aggregate row)
  page          TEXT,           -- canonical page URL (NULL = date-aggregate row)
  country       TEXT,           -- ISO 3166-1 alpha-3 country code
  clicks        INT DEFAULT 0,
  impressions   INT DEFAULT 0,
  ctr           NUMERIC(8,6),   -- 0.0 to 1.0
  position      NUMERIC(8,2),   -- average position (1-based)
  raw_data      JSONB,
  synced_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(connection_id, date, COALESCE(query, ''), COALESCE(page, ''), COALESCE(country, ''))
);

CREATE INDEX IF NOT EXISTS idx_gsc_client_date
  ON gsc_metrics(client_id, date);

-- Index for top queries report
CREATE INDEX IF NOT EXISTS idx_gsc_query
  ON gsc_metrics(client_id, query, date)
  WHERE query IS NOT NULL;

-- Index for top pages report
CREATE INDEX IF NOT EXISTS idx_gsc_page
  ON gsc_metrics(client_id, page, date)
  WHERE page IS NOT NULL;
