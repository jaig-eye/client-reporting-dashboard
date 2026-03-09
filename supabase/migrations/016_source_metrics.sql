-- 016_source_metrics.sql
-- Source-specific metrics tables. Each platform gets its own table that stores
-- the data as close to the source format as possible. No premature normalization.
--
-- Cross-source reporting should happen at query/reporting time, not at ingest time.
-- This gives us clean grip on each dataset and makes it easy to add new sources.

-- ─────────────────────────────────────────────
-- GOOGLE ADS METRICS
-- ─────────────────────────────────────────────
-- Stores campaign-level daily data using Google Ads native field names.
-- `cost_micros` is the native Google unit (divide by 1,000,000 for dollars).
-- Derived fields (spend, ctr, etc.) are stored for fast dashboard queries.

CREATE TABLE IF NOT EXISTS google_ads_metrics (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to the client and their specific Google Ads account connection
  connection_id             UUID          NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id                 UUID          NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- Campaign identity
  campaign_id               TEXT          NOT NULL,
  campaign_name             TEXT          NOT NULL DEFAULT '',
  campaign_status           TEXT,         -- ENABLED | PAUSED | REMOVED (Google native)
  campaign_type             TEXT,         -- SEARCH | DISPLAY | SHOPPING | VIDEO | etc.

  -- Date dimension
  date                      DATE          NOT NULL,

  -- Spend (native: cost_micros = dollars × 1,000,000)
  cost_micros               BIGINT        NOT NULL DEFAULT 0,
  spend                     DECIMAL(12,4) NOT NULL DEFAULT 0, -- cost_micros / 1_000_000

  -- Reach
  impressions               BIGINT        NOT NULL DEFAULT 0,
  clicks                    BIGINT        NOT NULL DEFAULT 0,

  -- Conversions (Google can report fractional conversions)
  conversions               DECIMAL(10,4) NOT NULL DEFAULT 0,
  conversions_value         DECIMAL(14,4) NOT NULL DEFAULT 0,
  view_through_conversions  BIGINT        NOT NULL DEFAULT 0,

  -- Derived metrics (computed at ingest for fast reads)
  roas                      DECIMAL(10,4) NOT NULL DEFAULT 0, -- conversions_value / spend
  ctr                       DECIMAL(10,6) NOT NULL DEFAULT 0, -- clicks / impressions
  cpc                       DECIMAL(10,4) NOT NULL DEFAULT 0, -- spend / clicks
  cpm                       DECIMAL(10,4) NOT NULL DEFAULT 0, -- (spend / impressions) × 1000

  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Uniqueness: one row per campaign per day per account connection
  UNIQUE(connection_id, campaign_id, date)
);

CREATE INDEX IF NOT EXISTS idx_google_metrics_client_date
  ON google_ads_metrics(client_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_google_metrics_connection_date
  ON google_ads_metrics(connection_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_google_metrics_campaign
  ON google_ads_metrics(client_id, campaign_id, date DESC);

CREATE TRIGGER google_ads_metrics_updated_at
  BEFORE UPDATE ON google_ads_metrics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────
-- META ADS METRICS
-- ─────────────────────────────────────────────
-- Stores campaign-level daily data using Meta Marketing API native fields.
-- Actions and action_values are stored as JSONB so conversion events can be
-- remapped at query time without requiring a re-sync (Meta reports many action
-- types per row; which one "counts" as a conversion depends on the campaign goal).

CREATE TABLE IF NOT EXISTS meta_ads_metrics (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to the client and their specific Meta ad account connection
  connection_id     UUID          NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id         UUID          NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- Campaign identity
  campaign_id       TEXT          NOT NULL,
  campaign_name     TEXT          NOT NULL DEFAULT '',

  -- Meta native campaign objective (LEAD_GENERATION, CONVERSIONS, BRAND_AWARENESS, etc.)
  -- Stored raw to inform goal-type auto-detection without hardcoding API values.
  objective         TEXT,

  -- Date dimension
  date              DATE          NOT NULL,

  -- Spend (Meta reports in currency units, not micros)
  spend             DECIMAL(12,4) NOT NULL DEFAULT 0,

  -- Reach and engagement
  impressions       BIGINT        NOT NULL DEFAULT 0,
  clicks            BIGINT        NOT NULL DEFAULT 0,
  reach             BIGINT        NOT NULL DEFAULT 0,
  frequency         DECIMAL(8,4)  NOT NULL DEFAULT 0,

  -- All Meta conversion events for this campaign/date, stored raw.
  -- Each entry: { "action_type": "lead", "value": "12" }
  -- This allows live remapping to any action type without re-syncing.
  actions           JSONB         NOT NULL DEFAULT '[]',

  -- Conversion revenue by action type.
  -- Each entry: { "action_type": "purchase", "value": "450.00" }
  action_values     JSONB         NOT NULL DEFAULT '[]',

  -- Derived metrics (computed at ingest from primary result action)
  -- These are recomputed whenever actions are remapped.
  conversions       DECIMAL(10,4) NOT NULL DEFAULT 0,
  conversion_value  DECIMAL(14,4) NOT NULL DEFAULT 0,
  roas              DECIMAL(10,4) NOT NULL DEFAULT 0,
  ctr               DECIMAL(10,6) NOT NULL DEFAULT 0,
  cpc               DECIMAL(10,4) NOT NULL DEFAULT 0,
  cpm               DECIMAL(10,4) NOT NULL DEFAULT 0,

  -- All unique action_type strings seen for this row (accumulated over syncs).
  -- Used to populate the "available conversion actions" selector in the UI.
  discovered_actions JSONB        NOT NULL DEFAULT '[]',

  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE(connection_id, campaign_id, date)
);

CREATE INDEX IF NOT EXISTS idx_meta_metrics_client_date
  ON meta_ads_metrics(client_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_meta_metrics_connection_date
  ON meta_ads_metrics(connection_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_meta_metrics_campaign
  ON meta_ads_metrics(client_id, campaign_id, date DESC);

CREATE TRIGGER meta_ads_metrics_updated_at
  BEFORE UPDATE ON meta_ads_metrics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────
-- SYNC JOBS: Replaces the old sync_logs table structure
-- ─────────────────────────────────────────────
-- Each sync run is scoped to a specific client_connection (not just a client+platform),
-- which gives us precise status per data source per client.

CREATE TABLE IF NOT EXISTS sync_jobs (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   UUID          NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id       UUID          NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- 'backfill' = initial historical pull; 'incremental' = daily catch-up; 'manual' = admin trigger
  job_type        TEXT          NOT NULL DEFAULT 'incremental' CHECK (job_type IN (
                                  'backfill', 'incremental', 'manual'
                                )),

  status          TEXT          NOT NULL DEFAULT 'running' CHECK (status IN (
                                  'running', 'success', 'error'
                                )),

  records_synced  INTEGER       NOT NULL DEFAULT 0,
  error_message   TEXT,

  date_from       DATE,
  date_to         DATE,

  started_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_connection ON sync_jobs(connection_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_client ON sync_jobs(client_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status, started_at DESC);
