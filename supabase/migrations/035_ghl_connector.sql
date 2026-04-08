-- ─────────────────────────────────────────────────────────────────────────────
-- 035: GoHighLevel CRM connector + metrics table
-- ─────────────────────────────────────────────────────────────────────────────

-- Extend connector type check constraint to include ghl + wordpress
ALTER TABLE connectors DROP CONSTRAINT IF EXISTS connectors_type_check;
ALTER TABLE connectors ADD CONSTRAINT connectors_type_check
  CHECK (type IN ('google_ads','meta_ads','google_analytics','google_search_console','ghl','wordpress'));

-- GHL metrics — daily CRM activity snapshot
CREATE TABLE IF NOT EXISTS ghl_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  contacts_created INT NOT NULL DEFAULT 0,
  total_calls      INT NOT NULL DEFAULT 0,
  missed_calls     INT NOT NULL DEFAULT 0,
  forms_submitted  INT NOT NULL DEFAULT 0,
  reviews_sent     INT NOT NULL DEFAULT 0,
  reviews_received INT NOT NULL DEFAULT 0,
  spam_leads       INT NOT NULL DEFAULT 0,
  emails_sent      INT NOT NULL DEFAULT 0,
  sms_sent         INT NOT NULL DEFAULT 0,
  raw_data         JSONB DEFAULT '{}',
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connection_id, date)
);

CREATE INDEX IF NOT EXISTS idx_ghl_metrics_client ON ghl_metrics(client_id, date);

-- GA4 metrics — daily website traffic
CREATE TABLE IF NOT EXISTS ga4_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  sessions        INT NOT NULL DEFAULT 0,
  users           INT NOT NULL DEFAULT 0,
  new_users       INT NOT NULL DEFAULT 0,
  page_views      INT NOT NULL DEFAULT 0,
  bounce_rate     NUMERIC(5,4) NOT NULL DEFAULT 0,
  avg_session_duration NUMERIC(10,2) NOT NULL DEFAULT 0,
  conversions     INT NOT NULL DEFAULT 0,
  raw_data        JSONB DEFAULT '{}',
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connection_id, date)
);

CREATE INDEX IF NOT EXISTS idx_ga4_client ON ga4_metrics(client_id, date);

-- WordPress connections metadata (site URL, credentials)
CREATE TABLE IF NOT EXISTS wp_sites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  site_url        TEXT NOT NULL,
  username        TEXT NOT NULL,
  app_password    TEXT NOT NULL,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connection_id)
);

-- Agency-level AI model configuration
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS ai_provider   TEXT DEFAULT 'anthropic',
  ADD COLUMN IF NOT EXISTS ai_model      TEXT DEFAULT 'claude-sonnet-4-6',
  ADD COLUMN IF NOT EXISTS ai_api_key    TEXT;
