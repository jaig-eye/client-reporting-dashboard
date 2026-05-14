-- Migration 110: True GSC daily totals table
-- The searchAnalytics/query API with dimensions=['date','query','page'] omits rows below
-- Google's privacy threshold (~10-30 searches). Summing these rows always undercounts vs
-- the real total. A separate call with dimensions=['date'] returns the true unfiltered totals.
-- This table stores those accurate daily numbers for use in KPI cards and the trend chart,
-- while gsc_metrics continues to store the dimensional breakdown for top queries/pages.

CREATE TABLE IF NOT EXISTS gsc_daily_totals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  clicks        INT NOT NULL DEFAULT 0,
  impressions   INT NOT NULL DEFAULT 0,
  ctr           NUMERIC(10,8),
  position      NUMERIC(10,4),
  synced_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(connection_id, date)
);

CREATE INDEX IF NOT EXISTS idx_gsc_daily_client_date ON gsc_daily_totals(client_id, date);
CREATE INDEX IF NOT EXISTS idx_gsc_daily_conn_date   ON gsc_daily_totals(connection_id, date);

GRANT ALL ON TABLE gsc_daily_totals TO service_role;
GRANT SELECT ON TABLE gsc_daily_totals TO authenticated;
