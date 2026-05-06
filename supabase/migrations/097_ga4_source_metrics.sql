CREATE TABLE IF NOT EXISTS ga4_source_metrics (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id    UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id)            ON DELETE CASCADE,
  date             DATE NOT NULL,
  source           TEXT NOT NULL DEFAULT '',
  medium           TEXT NOT NULL DEFAULT '',
  campaign         TEXT NOT NULL DEFAULT '',
  sessions         INT  DEFAULT 0,
  users            INT  DEFAULT 0,
  new_users        INT  DEFAULT 0,
  page_views       INT  DEFAULT 0,
  conversions      INT  DEFAULT 0,
  engaged_sessions INT  DEFAULT 0,
  synced_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(connection_id, date, source, medium, campaign)
);
CREATE INDEX IF NOT EXISTS idx_ga4_src_client_date ON ga4_source_metrics(client_id, date);
