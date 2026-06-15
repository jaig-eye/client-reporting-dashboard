-- Cron heartbeat table (referenced by System tab)
CREATE TABLE IF NOT EXISTS cron_heartbeats (
  cron_name   TEXT PRIMARY KEY,
  last_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_result TEXT
);

-- Site groups (for organizing sites by team, region, etc.)
CREATE TABLE IF NOT EXISTS site_groups (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sites registry
CREATE TABLE IF NOT EXISTS sites (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id        UUID REFERENCES clients(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  url              TEXT NOT NULL,
  platform         TEXT DEFAULT 'custom' CHECK (platform IN ('wordpress','ghl','bigcommerce','shopify','custom','other')),
  hosting_type     TEXT DEFAULT 'client' CHECK (hosting_type IN ('ours','client')),
  hosting_provider TEXT,
  server_account   TEXT,
  group_id         UUID REFERENCES site_groups(id) ON DELETE SET NULL,
  status           TEXT DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  notes            TEXT,
  -- Uptime state (written by cron)
  is_up                BOOLEAN,
  last_checked_at      TIMESTAMPTZ,
  last_status_code     INT,
  last_response_ms     INT,
  consecutive_failures INT DEFAULT 0,
  uptime_7d            NUMERIC(5,2),
  -- SSL state (written by weekly cron)
  ssl_issuer        TEXT,
  ssl_expires_at    TIMESTAMPTZ,
  ssl_days_remaining INT,
  ssl_last_checked  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sites_client_id_idx ON sites(client_id);
CREATE INDEX IF NOT EXISTS sites_group_id_idx  ON sites(group_id);
CREATE INDEX IF NOT EXISTS sites_status_idx    ON sites(status);

-- Raw uptime checks (pruned after 7 days by cron)
CREATE TABLE IF NOT EXISTS site_checks (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id     UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_up       BOOLEAN NOT NULL,
  status_code INT,
  response_ms INT,
  final_url   TEXT,
  error       TEXT
);

CREATE INDEX IF NOT EXISTS site_checks_site_checked_idx ON site_checks(site_id, checked_at DESC);

-- Daily rollup (permanent, one row per site per day)
CREATE TABLE IF NOT EXISTS site_check_daily (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id         UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  uptime_pct      NUMERIC(5,2),
  avg_response_ms INT,
  check_count     INT,
  incident_count  INT,
  UNIQUE(site_id, date)
);

CREATE INDEX IF NOT EXISTS site_check_daily_site_date_idx ON site_check_daily(site_id, date DESC);

-- Downtime incidents
CREATE TABLE IF NOT EXISTS site_incidents (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id    UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at   TIMESTAMPTZ,
  duration_s INT,
  cause      TEXT CHECK (cause IN ('timeout','4xx','5xx','dns','connection_refused','other'))
);

CREATE INDEX IF NOT EXISTS site_incidents_site_started_idx ON site_incidents(site_id, started_at DESC);
