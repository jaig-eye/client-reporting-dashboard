-- gsc_query_totals: accurate per-query impressions/CTR from dimensions=['date','query']
-- gsc_page_totals:  accurate per-page  impressions/CTR from dimensions=['date','page']
--
-- Unlike gsc_metrics (date+query+page), these tables avoid the impression-multiplication
-- problem where a single search showing multiple pages counted as multiple impressions.
-- Matches what GSC's Queries and Pages tabs report.

CREATE TABLE IF NOT EXISTS gsc_query_totals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  query         TEXT NOT NULL,
  clicks        INT  DEFAULT 0,
  impressions   INT  DEFAULT 0,
  ctr           NUMERIC(10,8),
  position      NUMERIC(10,4),
  synced_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(connection_id, date, query)
);

CREATE INDEX IF NOT EXISTS idx_gsc_query_totals_client_date
  ON gsc_query_totals(client_id, date);

GRANT ALL ON TABLE gsc_query_totals TO service_role;

CREATE TABLE IF NOT EXISTS gsc_page_totals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  page          TEXT NOT NULL,
  clicks        INT  DEFAULT 0,
  impressions   INT  DEFAULT 0,
  ctr           NUMERIC(10,8),
  position      NUMERIC(10,4),
  synced_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(connection_id, date, page)
);

CREATE INDEX IF NOT EXISTS idx_gsc_page_totals_client_date
  ON gsc_page_totals(client_id, date);

GRANT ALL ON TABLE gsc_page_totals TO service_role;
