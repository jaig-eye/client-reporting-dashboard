-- ─────────────────────────────────────────────────────────────────────────────
-- 043: Ahrefs SEO authority connector
-- ─────────────────────────────────────────────────────────────────────────────

-- Extend type constraint to include ahrefs (and restore google_business_profile
-- which was dropped from the 035 migration's re-creation)
ALTER TABLE connectors DROP CONSTRAINT IF EXISTS connectors_type_check;
ALTER TABLE connectors ADD CONSTRAINT connectors_type_check
  CHECK (type IN (
    'google_ads',
    'meta_ads',
    'google_analytics',
    'google_search_console',
    'google_business_profile',
    'ghl',
    'wordpress',
    'ahrefs'
  ));

-- Ahrefs domain authority metrics
-- One row per sync per client (domain-level snapshot — not daily granular data,
-- as Ahrefs DR/backlinks data updates weekly, not daily).
CREATE TABLE IF NOT EXISTS ahrefs_metrics (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id     UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date              DATE NOT NULL,              -- snapshot date (dateTo of sync window)
  domain_rating     NUMERIC(5,2),              -- 0–100
  ahrefs_rank       INT,                        -- global rank (lower = better)
  backlinks         INT,
  referring_domains INT,
  organic_keywords  INT,
  organic_traffic   INT,                        -- estimated monthly organic visits
  raw_data          JSONB,
  synced_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(connection_id, date)
);

CREATE INDEX IF NOT EXISTS idx_ahrefs_client_date ON ahrefs_metrics(client_id, date);
CREATE INDEX IF NOT EXISTS idx_ahrefs_connection_date ON ahrefs_metrics(connection_id, date);
