-- ╔═══════════════════════════════════════════════════════════════╗
-- ║  MASTER SCHEMA — client-reporting-dashboard                   ║
-- ║  Auto-generated from supabase/migrations/ (001–065)           ║
-- ║  DO NOT EDIT — regenerate from individual migration files     ║
-- ╚═══════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════
-- 001_initial_schema.sql
-- ═══════════════════════════════════════════════════════════════
-- Client Reporting Dashboard — Initial Schema

-- Clients (one row per agency client)
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ad accounts linked to each client
CREATE TABLE ad_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('google', 'meta')),
  account_id TEXT NOT NULL,
  account_name TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, platform, account_id)
);

-- Campaign-level daily metrics (denormalized for fast dashboard queries)
CREATE TABLE campaign_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('google', 'meta')),
  campaign_id TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  date DATE NOT NULL,
  spend DECIMAL(12, 2) DEFAULT 0,
  impressions BIGINT DEFAULT 0,
  clicks BIGINT DEFAULT 0,
  conversions DECIMAL(10, 2) DEFAULT 0,
  conversion_value DECIMAL(12, 2) DEFAULT 0,
  roas DECIMAL(10, 4) DEFAULT 0,
  ctr DECIMAL(8, 6) DEFAULT 0,
  cpc DECIMAL(10, 4) DEFAULT 0,
  cpm DECIMAL(10, 4) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ad_account_id, campaign_id, date)
);

-- Sync job logs
CREATE TABLE sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  ad_account_id UUID REFERENCES ad_accounts(id),
  platform TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'error')),
  records_synced INTEGER DEFAULT 0,
  error_message TEXT,
  date_range_start DATE,
  date_range_end DATE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Performance indexes
CREATE INDEX idx_metrics_client_date ON campaign_metrics(client_id, date DESC);
CREATE INDEX idx_metrics_client_platform ON campaign_metrics(client_id, platform, date DESC);
CREATE INDEX idx_metrics_account ON campaign_metrics(ad_account_id, date DESC);
CREATE INDEX idx_ad_accounts_client ON ad_accounts(client_id);
CREATE INDEX idx_sync_logs_client ON sync_logs(client_id, started_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clients_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER metrics_updated_at BEFORE UPDATE ON campaign_metrics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- 002_rls_policies.sql
-- ═══════════════════════════════════════════════════════════════
-- Row Level Security Policies
-- Clients see only their own data; admins see everything via service role

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

-- Clients can read their own record (matched by email)
CREATE POLICY "clients_read_own" ON clients
  FOR SELECT
  USING (email = auth.jwt() ->> 'email');

-- Clients can read their own ad accounts
CREATE POLICY "ad_accounts_read_own" ON ad_accounts
  FOR SELECT
  USING (
    client_id IN (
      SELECT id FROM clients WHERE email = auth.jwt() ->> 'email'
    )
  );

-- Clients can read their own campaign metrics
CREATE POLICY "metrics_read_own" ON campaign_metrics
  FOR SELECT
  USING (
    client_id IN (
      SELECT id FROM clients WHERE email = auth.jwt() ->> 'email'
    )
  );

-- Clients can read their own sync logs
CREATE POLICY "sync_logs_read_own" ON sync_logs
  FOR SELECT
  USING (
    client_id IN (
      SELECT id FROM clients WHERE email = auth.jwt() ->> 'email'
    )
  );

-- NOTE: Admin operations use the service role key (bypasses RLS)
-- Set SUPABASE_SERVICE_ROLE_KEY in your environment variables

-- ═══════════════════════════════════════════════════════════════
-- 003_token_auth.sql
-- ═══════════════════════════════════════════════════════════════
-- Replace Supabase Auth with token-based access
-- Each client gets a unique dashboard_token (auto-generated UUID)

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS dashboard_token UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL;

-- Fast token lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_dashboard_token
  ON clients(dashboard_token);

-- Disable RLS — all queries use service role key at the app layer
-- Access control is enforced by dashboard_token validation in middleware
ALTER TABLE clients DISABLE ROW LEVEL SECURITY;
ALTER TABLE ad_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_metrics DISABLE ROW LEVEL SECURITY;
ALTER TABLE sync_logs DISABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════
-- 004_seed_dummy_data.sql
-- ═══════════════════════════════════════════════════════════════
-- 004_seed_dummy_data.sql
-- Demo client "Acme Digital Co" with 90 days of realistic Google + Meta PPC data.
-- All inserts are idempotent (ON CONFLICT DO NOTHING).
--
-- Dashboard access URL:
--   /api/auth/access?token=44444444-4444-4444-4444-444444444444
--
-- DO NOT run this in a production environment with real client data.

-- ─── Ensure 003_token_auth columns/indexes exist (idempotent) ─────────────────
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS dashboard_token UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_dashboard_token
  ON clients(dashboard_token);

ALTER TABLE clients DISABLE ROW LEVEL SECURITY;
ALTER TABLE ad_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_metrics DISABLE ROW LEVEL SECURITY;
ALTER TABLE sync_logs DISABLE ROW LEVEL SECURITY;

-- ─── Client ────────────────────────────────────────────────────────────────────
INSERT INTO clients (id, name, email, slug, dashboard_token, created_at, updated_at)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Acme Digital Co',
  'demo@acmedemo.com',
  'acme-digital',
  '44444444-4444-4444-4444-444444444444',
  NOW() - INTERVAL '95 days',
  NOW()
) ON CONFLICT DO NOTHING;

-- ─── Ad Accounts ───────────────────────────────────────────────────────────────
INSERT INTO ad_accounts (id, client_id, platform, account_id, account_name, created_at)
VALUES
  (
    '22222222-2222-2222-2222-222222222222',
    '11111111-1111-1111-1111-111111111111',
    'google', '123-456-7890', 'Acme Google Ads',
    NOW() - INTERVAL '95 days'
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    '11111111-1111-1111-1111-111111111111',
    'meta', 'act_987654321', 'Acme Meta Ads',
    NOW() - INTERVAL '95 days'
  )
ON CONFLICT DO NOTHING;

-- ─── Campaign Metrics (90 days × 5 campaigns = 450 rows) ───────────────────────
--
-- Campaigns and their base daily values:
--   Google | Brand - Search              $35/day  CTR 12%  CPC $1.80  CVR 8%   AOV $55   ROAS ~8.9x
--   Google | Non-Brand - Search         $110/day  CTR 4.5% CPC $3.50  CVR 4%   AOV $95   ROAS ~3.5x
--   Google | Performance Max             $85/day  CTR 3.5% CPC $2.80  CVR 4.5% AOV $95   ROAS ~4.5x
--   Meta   | Retargeting - Website        $55/day  CTR 2.5% CPC $1.50  CVR 6%   AOV $85   ROAS ~5.5x
--   Meta   | Prospecting - Lookalike 1%  $130/day  CTR 1.2% CPC $2.00  CVR 2.5% AOV $90   ROAS ~1.7x
--
-- Daily variation: day-of-week factor × gentle upward trend (+13% over 90d) × oscillating noise

WITH campaign_defs (
  ad_account_id, platform, campaign_id, campaign_name,
  base_spend, base_ctr, base_cpc, base_conv_rate, avg_order_value
) AS (
  VALUES
    ('22222222-2222-2222-2222-222222222222'::UUID, 'google'::TEXT,
     'g_brand_001',    'Brand - Search',
     35.0::NUMERIC,  0.120::NUMERIC, 1.80::NUMERIC, 0.080::NUMERIC, 55.0::NUMERIC),

    ('22222222-2222-2222-2222-222222222222'::UUID, 'google'::TEXT,
     'g_nonbrand_001', 'Non-Brand - Search',
     110.0::NUMERIC, 0.045::NUMERIC, 3.50::NUMERIC, 0.040::NUMERIC, 95.0::NUMERIC),

    ('22222222-2222-2222-2222-222222222222'::UUID, 'google'::TEXT,
     'g_pmax_001',    'Performance Max',
     85.0::NUMERIC,  0.035::NUMERIC, 2.80::NUMERIC, 0.045::NUMERIC, 95.0::NUMERIC),

    ('33333333-3333-3333-3333-333333333333'::UUID, 'meta'::TEXT,
     'm_retarg_001',  'Retargeting - Website Visitors',
     55.0::NUMERIC,  0.025::NUMERIC, 1.50::NUMERIC, 0.060::NUMERIC, 85.0::NUMERIC),

    ('33333333-3333-3333-3333-333333333333'::UUID, 'meta'::TEXT,
     'm_prosp_001',   'Prospecting - Lookalike 1%',
     130.0::NUMERIC, 0.012::NUMERIC, 2.00::NUMERIC, 0.025::NUMERIC, 90.0::NUMERIC)
),

date_series (date, dow_factor, trend_factor, noise_factor) AS (
  SELECT
    d::DATE,
    -- Day-of-week multiplier
    CASE EXTRACT(DOW FROM d)::INT
      WHEN 0 THEN 0.55   -- Sun
      WHEN 1 THEN 0.95   -- Mon
      WHEN 2 THEN 1.02   -- Tue
      WHEN 3 THEN 1.08   -- Wed
      WHEN 4 THEN 1.12   -- Thu
      WHEN 5 THEN 1.15   -- Fri
      WHEN 6 THEN 0.68   -- Sat
    END::NUMERIC,
    -- Gentle upward trend: +13% from day 0 to day 89
    (1.0 + 0.00144 * (d::DATE - (CURRENT_DATE - 89)::DATE))::NUMERIC,
    -- Oscillating noise between 0.88 and 1.12
    (0.88 + 0.24 * (
      (SIN(EXTRACT(EPOCH FROM d::TIMESTAMPTZ) / 86400.0 * 1.3 + 2.5) + 1.0) / 2.0
    ))::NUMERIC
  FROM generate_series(
    CURRENT_DATE - INTERVAL '89 days',
    CURRENT_DATE,
    INTERVAL '1 day'
  ) AS d
),

-- Step 1: compute adjusted spend
with_spend AS (
  SELECT
    c.ad_account_id,
    c.platform,
    c.campaign_id,
    c.campaign_name,
    c.base_ctr,
    c.base_cpc,
    c.base_conv_rate,
    c.avg_order_value,
    ds.date,
    ROUND(c.base_spend * ds.dow_factor * ds.trend_factor * ds.noise_factor, 2) AS spend
  FROM campaign_defs c
  CROSS JOIN date_series ds
),

-- Step 2: derive clicks from CPC
with_clicks AS (
  SELECT *,
    GREATEST(1, ROUND(spend / base_cpc)::BIGINT) AS clicks
  FROM with_spend
),

-- Step 3: derive impressions, conversions, conversion value
with_all AS (
  SELECT *,
    GREATEST(clicks, ROUND(clicks::NUMERIC / base_ctr)::BIGINT)  AS impressions,
    ROUND((clicks::NUMERIC * base_conv_rate), 1)                  AS conversions,
    ROUND((clicks::NUMERIC * base_conv_rate * avg_order_value), 2) AS conversion_value
  FROM with_clicks
)

INSERT INTO campaign_metrics (
  client_id, ad_account_id, platform, campaign_id, campaign_name, date,
  spend, impressions, clicks, conversions, conversion_value,
  roas, ctr, cpc, cpm
)
SELECT
  '11111111-1111-1111-1111-111111111111'::UUID AS client_id,
  ad_account_id,
  platform,
  campaign_id,
  campaign_name,
  date,
  spend,
  impressions,
  clicks,
  conversions,
  conversion_value,
  CASE WHEN spend > 0     THEN ROUND(conversion_value / spend, 4)              ELSE 0 END AS roas,
  CASE WHEN impressions > 0 THEN ROUND(clicks::NUMERIC / impressions, 6)       ELSE 0 END AS ctr,
  CASE WHEN clicks > 0    THEN ROUND(spend / clicks, 4)                        ELSE 0 END AS cpc,
  CASE WHEN impressions > 0 THEN ROUND(spend / impressions * 1000, 4)          ELSE 0 END AS cpm
FROM with_all
ON CONFLICT (ad_account_id, campaign_id, date) DO NOTHING;

-- ─── Sync Logs ─────────────────────────────────────────────────────────────────
INSERT INTO sync_logs (
  client_id, ad_account_id, platform, status,
  records_synced, date_range_start, date_range_end,
  started_at, completed_at
) VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    'google', 'success', 270,
    CURRENT_DATE - 89, CURRENT_DATE,
    NOW() - INTERVAL '2 hours',
    NOW() - INTERVAL '2 hours' + INTERVAL '47 seconds'
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    '33333333-3333-3333-3333-333333333333',
    'meta', 'success', 180,
    CURRENT_DATE - 89, CURRENT_DATE,
    NOW() - INTERVAL '2 hours' + INTERVAL '52 seconds',
    NOW() - INTERVAL '2 hours' + INTERVAL '90 seconds'
  );

-- ═══════════════════════════════════════════════════════════════
-- 005_agency_settings.sql
-- ═══════════════════════════════════════════════════════════════
-- 005_agency_settings.sql
-- Single-row table for agency-level configuration managed via the admin UI.
-- Benchmarks are used to compute the Marketing Efficiency Score on the dashboard.

CREATE TABLE IF NOT EXISTS agency_settings (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_name              TEXT        NOT NULL DEFAULT 'My Agency',
  agency_logo_url          TEXT,
  -- Benchmark targets (used to score client performance 0-100)
  benchmark_roas           DECIMAL(10, 2) NOT NULL DEFAULT 3.00,
  benchmark_ctr            DECIMAL(8, 6)  NOT NULL DEFAULT 0.030000,  -- 3.0%
  benchmark_cpc            DECIMAL(10, 2) NOT NULL DEFAULT 3.00,
  benchmark_conv_rate      DECIMAL(8, 6)  NOT NULL DEFAULT 0.030000,  -- 3.0%
  benchmark_cpm            DECIMAL(10, 2) NOT NULL DEFAULT 15.00,
  -- UX defaults
  default_date_range_days  INTEGER        NOT NULL DEFAULT 30,
  updated_at               TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- Exactly one row ever
INSERT INTO agency_settings DEFAULT VALUES
ON CONFLICT DO NOTHING;

CREATE TRIGGER agency_settings_updated_at
  BEFORE UPDATE ON agency_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- 006_agency_connections.sql
-- ═══════════════════════════════════════════════════════════════
-- 006_agency_connections.sql
-- Shifts from per-client OAuth to agency-level connections.
-- Ad accounts are now discovered globally and then mapped to clients.

-- 1. Make client_id nullable so accounts can exist before being mapped
ALTER TABLE ad_accounts ALTER COLUMN client_id DROP NOT NULL;

-- 2. Relax unique constraint: an ad account is globally unique per platform,
--    regardless of which client it's mapped to
ALTER TABLE ad_accounts DROP CONSTRAINT IF EXISTS ad_accounts_client_id_platform_account_id_key;
ALTER TABLE ad_accounts ADD CONSTRAINT ad_accounts_platform_account_id_key UNIQUE (platform, account_id);

-- 3. Add Meta System User Token to agency_settings for agency-level connection
--    (never expires, covers all Business Manager ad accounts)
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS meta_system_user_token TEXT;

-- Index to make unlinked account lookup fast
CREATE INDEX IF NOT EXISTS idx_ad_accounts_unlinked
  ON ad_accounts(platform, account_id)
  WHERE client_id IS NULL;

-- ═══════════════════════════════════════════════════════════════
-- 007_meta_oauth_token.sql
-- ═══════════════════════════════════════════════════════════════
-- 007_meta_oauth_token.sql
-- Stores the agency-level Meta OAuth token in agency_settings.
-- Replaces the system user token approach with a standard OAuth long-lived token.
-- The agency authenticates once as the Business Manager admin; the token covers
-- all ad accounts they have access to via Business Manager.

ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS meta_access_token      TEXT,
  ADD COLUMN IF NOT EXISTS meta_token_expires_at  TIMESTAMPTZ;

-- meta_system_user_token is no longer used (replaced by OAuth flow)
-- Kept in schema for backwards compatibility; safe to leave NULL.

-- ═══════════════════════════════════════════════════════════════
-- 008_client_benchmarks.sql
-- ═══════════════════════════════════════════════════════════════
-- 008_client_benchmarks.sql
-- Per-client benchmark overrides.
-- NULL = inherit from agency_settings (global default).

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS benchmark_roas        DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS benchmark_ctr         DECIMAL(8, 6),
  ADD COLUMN IF NOT EXISTS benchmark_cpc         DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS benchmark_conv_rate   DECIMAL(8, 6),
  ADD COLUMN IF NOT EXISTS benchmark_cpm         DECIMAL(10, 2);

-- ═══════════════════════════════════════════════════════════════
-- 009_cron_settings.sql
-- ═══════════════════════════════════════════════════════════════
-- Add cron_enabled flag to agency_settings.
-- When false, the scheduled /api/cron/sync endpoint is a no-op even if Vercel fires it.
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS cron_enabled BOOLEAN NOT NULL DEFAULT true;

-- ═══════════════════════════════════════════════════════════════
-- 010_clear_meta_metrics.sql
-- ═══════════════════════════════════════════════════════════════
-- 010_clear_meta_metrics.sql
-- Clears all Meta campaign_metrics rows so the corrected sync logic
-- (using Meta's "results" field instead of summing all offsite_conversion.* subtypes)
-- can backfill clean data.
--
-- Run this ONCE in Supabase SQL editor, then use the Backfill All button
-- in Agency Settings to re-pull Meta historical data.

DELETE FROM campaign_metrics
WHERE platform = 'meta';

-- ═══════════════════════════════════════════════════════════════
-- 011_metric_config.sql
-- ═══════════════════════════════════════════════════════════════
-- 011_metric_config.sql
-- Adds flexible per-client and global metric configuration.
--
-- metric_config JSONB shape:
--   {
--     "meta_conversion_action": "lead",   -- which Meta action_type counts as conversions
--     "conversion_label": "Leads"         -- display name override for the conversions metric
--   }
--
-- available_meta_actions JSONB on ad_accounts:
--   Populated during Meta syncs with all unique action_type strings returned by the API.
--   Used to populate the metric mapping dropdown in the admin UI.

ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS metric_config JSONB NOT NULL DEFAULT '{}';

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS metric_config JSONB NOT NULL DEFAULT '{}';

ALTER TABLE ad_accounts
  ADD COLUMN IF NOT EXISTS available_meta_actions JSONB;

-- ═══════════════════════════════════════════════════════════════
-- 012_raw_meta_actions.sql
-- ═══════════════════════════════════════════════════════════════
-- Store all raw Meta action types per campaign-day row.
-- This allows the admin to change the conversion mapping at any time
-- without needing to re-sync historical data — the dashboard re-computes
-- conversions from raw_meta_actions using the current metric_config.
ALTER TABLE campaign_metrics ADD COLUMN IF NOT EXISTS raw_meta_actions JSONB;

-- ═══════════════════════════════════════════════════════════════
-- 013_campaign_settings.sql
-- ═══════════════════════════════════════════════════════════════
-- 013_campaign_settings.sql
-- Per-campaign goal type and conversion action configuration.
-- Allows each campaign to have its own goal (lead_gen, ecommerce, calls, etc.)
-- and its own Meta conversion action override.
--
-- goal_type values:
--   'lead_gen'     — count leads/form fills, show CPL, no ROAS
--   'ecommerce'    — count purchases, show ROAS + Revenue
--   'calls'        — count phone calls, show Cost/Call
--   'appointments' — count appointments/bookings, show Cost/Appt
--   'awareness'    — awareness/reach campaigns, show Impressions/CPM/CTR
--   'other'        — custom goal, show generic conversion count
--   'unset'        — not yet configured, falls back to client/global config

CREATE TABLE IF NOT EXISTS campaign_settings (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID          NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform              TEXT          NOT NULL CHECK (platform IN ('google', 'meta')),
  campaign_id           TEXT          NOT NULL,
  campaign_name         TEXT          NOT NULL DEFAULT '',
  goal_type             TEXT          NOT NULL DEFAULT 'unset',
  -- Meta-only: overrides client-level and global meta_conversion_action for this campaign
  meta_conversion_action TEXT,
  -- Display label override (e.g. "Leads", "Purchases", "Phone Calls")
  conversion_label      TEXT,
  -- When true the campaign is excluded from the client dashboard entirely
  hidden                BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, platform, campaign_id)
);

CREATE INDEX IF NOT EXISTS campaign_settings_client_id_idx ON campaign_settings(client_id);

-- ═══════════════════════════════════════════════════════════════
-- 014_campaign_discovery_fn.sql
-- ═══════════════════════════════════════════════════════════════
-- 014_campaign_discovery_fn.sql
-- SQL function for fast DISTINCT campaign discovery.
-- Without this the JS client had to fetch thousands of metric rows and
-- deduplicate in memory, hitting Supabase's default 1 000-row cap.

CREATE OR REPLACE FUNCTION get_client_campaigns(p_client_id UUID)
RETURNS TABLE(campaign_id TEXT, campaign_name TEXT, platform TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (platform, campaign_id)
    campaign_id,
    campaign_name,
    platform
  FROM campaign_metrics
  WHERE client_id = p_client_id
  ORDER BY platform, campaign_id, date DESC;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 015_connectors.sql
-- ═══════════════════════════════════════════════════════════════
-- 015_connectors.sql
-- Replaces the flat ad_accounts + platform approach with a proper connector architecture.
-- A connector is an agency-level authenticated connection to an external platform (Google Ads,
-- Meta, Google Analytics, Search Console, etc.). Multiple clients can use the same connector,
-- each linked to their own account/property within that platform.
--
-- This design means:
--   - Adding a new data source = adding a new connector type (no schema changes required)
--   - Agency connects once; clients are assigned accounts from that connector pool
--   - Each source keeps its own metrics table (see migrations 016+)

-- ─────────────────────────────────────────────
-- CONNECTORS: Agency-level platform connections
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS connectors (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Platform identifier. Extensible: add new types without altering the table.
  type            TEXT          NOT NULL CHECK (type IN (
                                  'google_ads',
                                  'meta_ads',
                                  'google_analytics',
                                  'google_search_console'
                                )),

  -- Human-readable label set by the admin (e.g. "LaunchLocal Google MCC")
  label           TEXT          NOT NULL DEFAULT '',

  -- Connection health status. 'active' means the connector is authenticated and working.
  status          TEXT          NOT NULL DEFAULT 'disconnected' CHECK (status IN (
                                  'active', 'error', 'disconnected', 'pending'
                                )),

  -- OAuth tokens and API credentials, stored as JSONB so each connector type
  -- can store whatever fields it needs (access_token, refresh_token, expires_at, etc.)
  -- without requiring schema changes per connector.
  auth            JSONB         NOT NULL DEFAULT '{}',

  -- Connector-specific configuration (e.g. MCC customer ID for Google Ads,
  -- Business Manager ID for Meta). Separate from auth so it can be read safely.
  config          JSONB         NOT NULL DEFAULT '{}',

  -- Timestamp of last successful connectivity check.
  last_checked_at TIMESTAMPTZ,

  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connectors_type ON connectors(type);
CREATE INDEX IF NOT EXISTS idx_connectors_status ON connectors(status);

CREATE TRIGGER connectors_updated_at
  BEFORE UPDATE ON connectors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- CLIENT_CONNECTIONS: Links a client to a specific account within a connector
-- ─────────────────────────────────────────────────────────────────────────────
-- A client can be connected to multiple connectors (e.g. Google Ads + Meta).
-- A single connector can serve multiple clients (e.g. one Google MCC → many ad accounts).
--
-- external_id is the platform-native account identifier:
--   - Google Ads: customer ID (e.g. "1234567890")
--   - Meta:       ad account ID (e.g. "act_123456789")
--   - Analytics:  property ID (e.g. "GA4-123456")
--   - Search Console: site URL (e.g. "https://example.com")

CREATE TABLE IF NOT EXISTS client_connections (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID          NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  connector_id    UUID          NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,

  -- The account/property/site ID within the platform that belongs to this client
  external_id     TEXT          NOT NULL,
  external_name   TEXT,

  -- Connection-level status (a client's connection can be paused independently of the connector)
  status          TEXT          NOT NULL DEFAULT 'active' CHECK (status IN (
                                  'active', 'paused', 'error'
                                )),

  -- Timestamp of the most recent successful data sync for this connection
  last_synced_at  TIMESTAMPTZ,

  -- Optional: earliest date to pull data from (NULL = use connector/system default)
  sync_from       DATE,

  -- Connection-level config overrides (e.g. per-client conversion value, hidden campaigns)
  config          JSONB         NOT NULL DEFAULT '{}',

  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- A client can only be connected to each account once per connector
  UNIQUE(client_id, connector_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_client_connections_client ON client_connections(client_id);
CREATE INDEX IF NOT EXISTS idx_client_connections_connector ON client_connections(connector_id);
CREATE INDEX IF NOT EXISTS idx_client_connections_status ON client_connections(status);

CREATE TRIGGER client_connections_updated_at
  BEFORE UPDATE ON client_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- CONNECTOR ACCOUNTS: Discovered/cached accounts available within a connector
-- ─────────────────────────────────────────────────────────────────────────────
-- When an agency connects Google Ads (MCC) or Meta (Business Manager), we can
-- discover all available accounts. This table caches that list so admins can
-- assign accounts to clients without hitting the API every time.

CREATE TABLE IF NOT EXISTS connector_accounts (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id    UUID          NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,

  -- Platform-native account ID
  external_id     TEXT          NOT NULL,
  external_name   TEXT,

  -- Additional metadata from the platform (currency, timezone, etc.)
  metadata        JSONB         NOT NULL DEFAULT '{}',

  -- Whether this account is already assigned to a client
  is_linked       BOOLEAN       NOT NULL DEFAULT FALSE,

  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE(connector_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_connector_accounts_connector ON connector_accounts(connector_id);
CREATE INDEX IF NOT EXISTS idx_connector_accounts_linked ON connector_accounts(connector_id, is_linked);

CREATE TRIGGER connector_accounts_updated_at
  BEFORE UPDATE ON connector_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- 016_source_metrics.sql
-- ═══════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════
-- 017_campaign_categories.sql
-- ═══════════════════════════════════════════════════════════════
-- 017_campaign_categories.sql
-- Replaces the old campaign_settings / goal_type system with a clean category model.
-- Campaign categories are defined at the agency level (with agency defaults),
-- and clients can have their campaigns assigned to categories with optional overrides.
--
-- This removes the mixed "campaign assigning + conversion linking" from before
-- and replaces it with a two-level taxonomy: agency categories → client assignments.

-- ─────────────────────────────────────────────
-- CAMPAIGN CATEGORIES: Agency-defined taxonomy
-- ─────────────────────────────────────────────
-- The agency defines categories that make sense for their business
-- (e.g. "Lead Gen", "Ecommerce", "Brand Awareness", "Retargeting").
-- These are reusable across all clients.

CREATE TABLE IF NOT EXISTS campaign_categories (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  name          TEXT          NOT NULL,

  -- Color used in the UI (hex string, e.g. "#3b82f6")
  color         TEXT          NOT NULL DEFAULT '#6b7280',

  description   TEXT,

  -- Controls which metrics are highlighted for this category.
  -- Values: 'lead_gen' | 'ecommerce' | 'awareness' | 'engagement' | 'custom'
  -- Informs the dashboard display logic (ROAS vs CPL vs CPM emphasis).
  display_mode  TEXT          NOT NULL DEFAULT 'custom' CHECK (display_mode IN (
                                'lead_gen', 'ecommerce', 'awareness', 'engagement', 'custom'
                              )),

  -- Default conversion value for campaigns in this category (agency-wide default).
  -- Can be overridden at the client_campaign_assignment level.
  default_conversion_value  DECIMAL(10,2) NOT NULL DEFAULT 0,

  -- Label for the conversion metric (e.g. "Leads", "Purchases", "Phone Calls").
  -- Used on the client dashboard instead of the generic "Conversions".
  conversion_label          TEXT          NOT NULL DEFAULT 'Conversions',

  -- When true, new campaigns auto-assigned to this category via name-matching rules
  is_default    BOOLEAN       NOT NULL DEFAULT FALSE,

  -- Display order in the UI
  sort_order    INTEGER       NOT NULL DEFAULT 0,

  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_categories_default ON campaign_categories(is_default);

CREATE TRIGGER campaign_categories_updated_at
  BEFORE UPDATE ON campaign_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed a default set of categories. Admins can rename, recolor, or add their own.
INSERT INTO campaign_categories (name, color, display_mode, conversion_label, default_conversion_value, sort_order)
VALUES
  ('Lead Generation',  '#3b82f6', 'lead_gen',   'Leads',    0, 1),
  ('Ecommerce',        '#10b981', 'ecommerce',  'Purchases', 0, 2),
  ('Brand Awareness',  '#8b5cf6', 'awareness',  'Views',     0, 3),
  ('Retargeting',      '#f59e0b', 'lead_gen',   'Leads',     0, 4),
  ('Calls',            '#06b6d4', 'lead_gen',   'Calls',     0, 5)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- CLIENT CAMPAIGN ASSIGNMENTS: Per-campaign category at the client level
-- ─────────────────────────────────────────────────────────────────────────
-- Campaigns are discovered during syncs and auto-inserted here.
-- Admins then assign categories and optionally override conversion logic.

CREATE TABLE IF NOT EXISTS client_campaign_assignments (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                 UUID          NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- The data source this campaign comes from (matches connector type)
  source                    TEXT          NOT NULL CHECK (source IN (
                                            'google_ads', 'meta_ads',
                                            'google_analytics', 'google_search_console'
                                          )),

  -- Platform-native campaign identifier
  campaign_id               TEXT          NOT NULL,
  campaign_name             TEXT          NOT NULL DEFAULT '',

  -- Assigned category (NULL = unassigned / uncategorised)
  category_id               UUID          REFERENCES campaign_categories(id) ON DELETE SET NULL,

  -- Conversion value override for this specific client + campaign.
  -- If NULL, falls back to: category default → agency default → 0.
  conversion_value_override DECIMAL(10,2),

  -- For Meta: which action_type to count as the primary conversion.
  -- NULL = use the category/client default.
  meta_conversion_action    TEXT,

  -- When true, this campaign is excluded from the client dashboard entirely
  hidden                    BOOLEAN       NOT NULL DEFAULT FALSE,

  -- Custom notes or labels for this campaign (visible in admin only)
  notes                     TEXT,

  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE(client_id, source, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_assignments_client ON client_campaign_assignments(client_id);
CREATE INDEX IF NOT EXISTS idx_campaign_assignments_category ON client_campaign_assignments(category_id);

CREATE TRIGGER client_campaign_assignments_updated_at
  BEFORE UPDATE ON client_campaign_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- CONVERSION DEFAULTS: Consistent conversion value configuration
-- ─────────────────────────────────────────────────────────────────────────
-- Stores the default conversion value used when no campaign-level override exists.
-- Follows a hierarchy: campaign override → client default → agency default.
-- Agency default lives in agency_settings; client defaults stored here.

-- Add client-level conversion value default to clients table
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS default_conversion_value DECIMAL(10,2) DEFAULT NULL;

-- Add agency-level conversion value default to agency_settings
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS default_conversion_value DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Add cron_enabled flag (was missing from the agency_settings table)
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS cron_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- ═══════════════════════════════════════════════════════════════
-- 018_users.sql
-- ═══════════════════════════════════════════════════════════════
-- 018_users.sql
-- Multi-user support for the admin panel.
-- Designed to support full RBAC in the future — for now only 'admin' and 'viewer' roles exist.
-- The current single-password approach (ADMIN_PASSWORD env var) can coexist during migration.

CREATE TABLE IF NOT EXISTS users (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Display name shown in the sidebar user card
  name            TEXT          NOT NULL DEFAULT 'Admin',

  email           TEXT          NOT NULL UNIQUE,

  -- bcrypt hash of the user's password (cost ≥ 12)
  password_hash   TEXT          NOT NULL,

  -- Optional avatar (URL to an image or a data URL for uploaded avatars)
  avatar_url      TEXT,

  -- Role controls what the user can do. 'admin' has full access.
  -- 'viewer' can see client dashboards but cannot modify settings or trigger syncs.
  -- Additional roles can be added here without schema changes.
  role            TEXT          NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'viewer')),

  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,

  last_login_at   TIMESTAMPTZ,

  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Link agency_settings to a primary admin user
-- This is nullable so it remains backward compatible with the env-var auth approach
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS primary_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Version tracking for the admin UI display
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS app_version TEXT NOT NULL DEFAULT '2.0.0';

-- ═══════════════════════════════════════════════════════════════
-- 019_multi_admin.sql
-- ═══════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 019: Multi-admin support & logo columns
-- Run after: 018_users.sql
--
-- Changes:
--   1. Add logo_url column to clients table (if not already present)
--   2. Ensure users table password_hash column exists
--   3. Add last_login_at column to users (used to track sign-in activity)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Client logo (displayed on client-facing dashboard)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- 2. Users: ensure password_hash and last_login_at exist
--    (018_users.sql may already have these; ADD COLUMN IF NOT EXISTS is safe)
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- 3. Remove the old role CHECK constraint and replace with a wider one
--    in case 018 was run with only 'admin' | 'viewer'
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'viewer'));

-- Note: 'super_admin' is NOT stored in the DB — the super admin is
-- authenticated via the ADMIN_PASSWORD environment variable only.
-- Regular admin accounts in the users table use role = 'admin'.

-- 4. Index on users.email for fast login lookup
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (LOWER(email));

-- ═══════════════════════════════════════════════════════════════
-- 020_ad_fuel.sql
-- ═══════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 020: Ad Fuel margin/markup system
-- Run after: 019_multi_admin.sql
--
-- "Ad Fuel" is the agency's marked-up spend figure shown to clients.
-- The agency keeps ad_fuel_cut % for optimization; the rest goes to platforms.
--
-- Formula:
--   ad_fuel_spend = raw_platform_spend / (1 - ad_fuel_cut)
--   Example: $800 raw spend ÷ (1 - 0.20) = $1,000 Ad Fuel Spend
--            → agency keeps $200, client sees $1,000
--
-- A client with ad_fuel_cut = 0 sees raw spend (100% goes to ads).
-- Client-level setting overrides global when set.
-- ─────────────────────────────────────────────────────────────────────────────

-- Global default on agency_settings (default 20%)
ALTER TABLE agency_settings ADD COLUMN IF NOT EXISTS ad_fuel_cut NUMERIC(5,4) DEFAULT 0.20;

-- Per-client override (NULL = use agency global)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ad_fuel_cut NUMERIC(5,4);

-- Comment to document the convention
COMMENT ON COLUMN agency_settings.ad_fuel_cut IS
  'Agency margin as a decimal (0.20 = 20%). ad_fuel_spend = raw_spend / (1 - cut).';
COMMENT ON COLUMN clients.ad_fuel_cut IS
  'Per-client Ad Fuel cut override. NULL = use agency_settings.ad_fuel_cut.';

-- ═══════════════════════════════════════════════════════════════
-- 021_ad_level_metrics.sql
-- ═══════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 021: Ad-level metrics tables
-- Run after: 020_ad_fuel.sql
--
-- Stores ad-group/ad level data for campaign drill-down on the dashboard.
-- Synced after campaign-level metrics during each sync job.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Google Ads: ad-group → ad level ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_ads_ad_metrics (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id    UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id)            ON DELETE CASCADE,

  -- Hierarchy
  campaign_id      TEXT NOT NULL,
  campaign_name    TEXT NOT NULL DEFAULT '',
  ad_group_id      TEXT NOT NULL,
  ad_group_name    TEXT NOT NULL DEFAULT '',
  ad_id            TEXT NOT NULL,
  ad_name          TEXT          DEFAULT '',
  ad_type          TEXT,                       -- EXPANDED_TEXT_AD, RESPONSIVE_SEARCH_AD, etc.

  date             DATE NOT NULL,

  -- Raw platform metrics
  cost_micros      BIGINT  NOT NULL DEFAULT 0,
  spend            NUMERIC(12,2) NOT NULL DEFAULT 0,
  impressions      INTEGER NOT NULL DEFAULT 0,
  clicks           INTEGER NOT NULL DEFAULT 0,
  conversions      NUMERIC(10,4) NOT NULL DEFAULT 0,
  conversions_value NUMERIC(12,2) NOT NULL DEFAULT 0,

  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (connection_id, ad_id, date)
);

CREATE INDEX IF NOT EXISTS google_ads_ad_metrics_campaign_idx
  ON google_ads_ad_metrics (connection_id, campaign_id, date);

-- ── Meta Ads: adset → ad level ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meta_ads_ad_metrics (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id    UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id)            ON DELETE CASCADE,

  -- Hierarchy
  campaign_id      TEXT NOT NULL,
  campaign_name    TEXT NOT NULL DEFAULT '',
  adset_id         TEXT,
  adset_name       TEXT          DEFAULT '',
  ad_id            TEXT NOT NULL,
  ad_name          TEXT          DEFAULT '',
  thumbnail_url    TEXT,                       -- From ad creative, fetched at sync time

  date             DATE NOT NULL,

  -- Raw platform metrics
  spend            NUMERIC(12,2) NOT NULL DEFAULT 0,
  impressions      INTEGER NOT NULL DEFAULT 0,
  clicks           INTEGER NOT NULL DEFAULT 0,
  reach            INTEGER NOT NULL DEFAULT 0,

  -- JSONB for live conversion remapping (same pattern as campaign-level)
  actions          JSONB NOT NULL DEFAULT '[]',
  action_values    JSONB NOT NULL DEFAULT '[]',

  -- Derived at sync time (approximate)
  conversions      NUMERIC(10,4) NOT NULL DEFAULT 0,
  conversion_value NUMERIC(12,2) NOT NULL DEFAULT 0,

  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (connection_id, ad_id, date)
);

CREATE INDEX IF NOT EXISTS meta_ads_ad_metrics_campaign_idx
  ON meta_ads_ad_metrics (connection_id, campaign_id, date);

-- Trigger updated_at on both tables
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at') THEN
    CREATE TRIGGER google_ads_ad_metrics_updated_at
      BEFORE UPDATE ON google_ads_ad_metrics
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();

    CREATE TRIGGER meta_ads_ad_metrics_updated_at
      BEFORE UPDATE ON meta_ads_ad_metrics
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 022_dummy_data.sql
-- ═══════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- 022_dummy_data.sql
-- Demo client "Apex Roofing Co." with realistic Google Ads + Meta Ads data.
-- Run this against your Supabase database to explore the dashboard.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Client ────────────────────────────────────────────────────────────────
-- dashboard_token (UUID) — use this to access the client dashboard:
--   Set client_token cookie to: eeeeeeee-de00-0000-0000-000000000001
--   Or visit /access and enter that token.
INSERT INTO clients (id, name, email, slug, dashboard_token, ad_fuel_cut)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'Apex Roofing Co.',
  'demo@apexroofing.example',
  'apex-roofing-co',
  'eeeeeeee-de00-0000-0000-000000000001',
  NULL
)
ON CONFLICT (id) DO NOTHING;

-- ── 2. Connectors (agency-level) ─────────────────────────────────────────────
-- Columns: type (not source), auth (not credentials)
INSERT INTO connectors (id, type, label, auth, status)
VALUES
  (
    'bbbbbbbb-0001-0000-0000-000000000001',
    'google_ads',
    'Demo Google Ads Connector',
    '{"developer_token":"DEMO","client_id":"DEMO","client_secret":"DEMO","refresh_token":"DEMO","customer_id":"1234567890"}',
    'active'
  ),
  (
    'bbbbbbbb-0002-0000-0000-000000000001',
    'meta_ads',
    'Demo Meta Ads Connector',
    '{"app_id":"DEMO","app_secret":"DEMO","access_token":"DEMO","ad_account_id":"act_1234567890"}',
    'active'
  )
ON CONFLICT (id) DO NOTHING;

-- ── 3. Client connections ─────────────────────────────────────────────────────
-- external_id is required (platform-native account ID)
INSERT INTO client_connections (id, client_id, connector_id, external_id, external_name, status)
VALUES
  (
    'cccccccc-0001-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'bbbbbbbb-0001-0000-0000-000000000001',
    '1234567890',
    'Apex Roofing Google Ads',
    'active'
  ),
  (
    'cccccccc-0002-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'bbbbbbbb-0002-0000-0000-000000000001',
    'act_1234567890',
    'Apex Roofing Meta Ads',
    'active'
  )
ON CONFLICT (id) DO NOTHING;

-- ── 4. Campaign → category assignments ───────────────────────────────────────
-- campaign_categories is agency-wide (seeded in 017). We look up by name.
INSERT INTO client_campaign_assignments
  (client_id, source, campaign_id, campaign_name, category_id)
VALUES
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'google_ads', 'goog_camp_001', 'Branded – Roofing Services',
    (SELECT id FROM campaign_categories WHERE name = 'Lead Generation' LIMIT 1)
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'google_ads', 'goog_camp_002', 'Competitors – Best Roofers',
    (SELECT id FROM campaign_categories WHERE name = 'Lead Generation' LIMIT 1)
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'google_ads', 'goog_camp_003', 'Display Retargeting',
    (SELECT id FROM campaign_categories WHERE name = 'Retargeting' LIMIT 1)
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'meta_ads', 'meta_camp_001', 'Facebook Lead Ads – Roof Inspections',
    (SELECT id FROM campaign_categories WHERE name = 'Lead Generation' LIMIT 1)
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'meta_ads', 'meta_camp_002', 'Instagram Awareness – Storm Season',
    (SELECT id FROM campaign_categories WHERE name = 'Brand Awareness' LIMIT 1)
  )
ON CONFLICT (client_id, source, campaign_id) DO NOTHING;

-- ── 5. Google Ads campaign metrics (30 days, 3 campaigns) ────────────────────
-- NOTE: column is conversions_value (not conversion_value); client_id required
INSERT INTO google_ads_metrics (
  connection_id, client_id, campaign_id, campaign_name, date,
  spend, impressions, clicks, conversions, conversions_value
)
SELECT
  'cccccccc-0001-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'goog_camp_001', 'Branded – Roofing Services', d::date,
  ROUND((18 + random()::numeric * 10 + CASE WHEN EXTRACT(dow FROM d) IN (1,2,3,4,5) THEN 4 ELSE 0 END)::numeric, 2),
  (900  + floor(random()::numeric * 500))::int,
  (55   + floor(random()::numeric * 35))::int,
  ROUND((4 + random()::numeric * 5)::numeric, 4),
  ROUND((4 + random()::numeric * 5) * (350 + random()::numeric * 60)::numeric, 2)
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, campaign_id, date) DO NOTHING;

INSERT INTO google_ads_metrics (
  connection_id, client_id, campaign_id, campaign_name, date,
  spend, impressions, clicks, conversions, conversions_value
)
SELECT
  'cccccccc-0001-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'goog_camp_002', 'Competitors – Best Roofers', d::date,
  ROUND((35 + random()::numeric * 20)::numeric, 2),
  (2500 + floor(random()::numeric * 1000))::int,
  (90   + floor(random()::numeric * 50))::int,
  ROUND((3 + random()::numeric * 6)::numeric, 4),
  ROUND((3 + random()::numeric * 6) * (300 + random()::numeric * 80)::numeric, 2)
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, campaign_id, date) DO NOTHING;

INSERT INTO google_ads_metrics (
  connection_id, client_id, campaign_id, campaign_name, date,
  spend, impressions, clicks, conversions, conversions_value
)
SELECT
  'cccccccc-0001-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'goog_camp_003', 'Display Retargeting', d::date,
  ROUND((8 + random()::numeric * 6)::numeric, 2),
  (12000 + floor(random()::numeric * 5000))::int,
  (20    + floor(random()::numeric * 20))::int,
  ROUND((0.5 + random()::numeric * 1.5)::numeric, 4),
  ROUND((0.5 + random()::numeric * 1.5) * (200 + random()::numeric * 100)::numeric, 2)
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, campaign_id, date) DO NOTHING;

-- ── 6. Meta Ads campaign metrics (30 days, 2 campaigns) ──────────────────────
-- NOTE: client_id required; actions/action_values required (NOT NULL DEFAULT '[]')
INSERT INTO meta_ads_metrics (
  connection_id, client_id, campaign_id, campaign_name, date,
  spend, impressions, clicks,
  conversions, conversion_value,
  actions, action_values
)
SELECT
  'cccccccc-0002-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'meta_camp_001', 'Facebook Lead Ads – Roof Inspections', d::date,
  ROUND((45 + random()::numeric * 25)::numeric, 2),
  (8000 + floor(random()::numeric * 4000))::int,
  (120  + floor(random()::numeric * 80))::int,
  ROUND((5 + random()::numeric * 8)::numeric, 4),
  ROUND((5 + random()::numeric * 8) * (280 + random()::numeric * 80)::numeric, 2),
  '[{"action_type":"lead","value":"5"}]'::jsonb,
  '[]'::jsonb
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, campaign_id, date) DO NOTHING;

INSERT INTO meta_ads_metrics (
  connection_id, client_id, campaign_id, campaign_name, date,
  spend, impressions, clicks,
  conversions, conversion_value,
  actions, action_values
)
SELECT
  'cccccccc-0002-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'meta_camp_002', 'Instagram Awareness – Storm Season', d::date,
  ROUND((20 + random()::numeric * 10)::numeric, 2),
  (25000 + floor(random()::numeric * 10000))::int,
  (60    + floor(random()::numeric * 40))::int,
  ROUND((0.5 + random()::numeric * 2)::numeric, 4),
  ROUND((0.5 + random()::numeric * 2) * (150 + random()::numeric * 100)::numeric, 2),
  '[{"action_type":"post_engagement","value":"1"}]'::jsonb,
  '[]'::jsonb
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, campaign_id, date) DO NOTHING;

-- ── 7. Google Ads ad-level metrics (6 ads, 30 days each) ─────────────────────
-- NOTE: google_ads_ad_metrics requires client_id (NOT NULL)

INSERT INTO google_ads_ad_metrics (
  connection_id, client_id, campaign_id, ad_id, ad_name, ad_type,
  ad_group_id, ad_group_name, date,
  spend, impressions, clicks, conversions, conversions_value
)
SELECT
  'cccccccc-0001-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'goog_camp_001', 'goog_ad_001',
  'Apex Roofing | Free Estimate | Call Now',
  'EXPANDED_TEXT_AD',
  'goog_ag_001', 'Branded – Exact', d::date,
  ROUND((8 + random()::numeric * 5)::numeric, 2),
  (400 + floor(random()::numeric * 200))::int,
  (25  + floor(random()::numeric * 15))::int,
  ROUND((2 + random()::numeric * 2)::numeric, 4),
  ROUND((2 + random()::numeric * 2) * (360 + random()::numeric * 40)::numeric, 2)
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, ad_id, date) DO NOTHING;

INSERT INTO google_ads_ad_metrics (
  connection_id, client_id, campaign_id, ad_id, ad_name, ad_type,
  ad_group_id, ad_group_name, date,
  spend, impressions, clicks, conversions, conversions_value
)
SELECT
  'cccccccc-0001-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'goog_camp_001', 'goog_ad_002',
  '#1 Roofing Company | Apex | Same Day',
  'RESPONSIVE_SEARCH_AD',
  'goog_ag_001', 'Branded – Exact', d::date,
  ROUND((6 + random()::numeric * 4)::numeric, 2),
  (300 + floor(random()::numeric * 150))::int,
  (18  + floor(random()::numeric * 12))::int,
  ROUND((1.5 + random()::numeric * 2)::numeric, 4),
  ROUND((1.5 + random()::numeric * 2) * (340 + random()::numeric * 60)::numeric, 2)
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, ad_id, date) DO NOTHING;

INSERT INTO google_ads_ad_metrics (
  connection_id, client_id, campaign_id, ad_id, ad_name, ad_type,
  ad_group_id, ad_group_name, date,
  spend, impressions, clicks, conversions, conversions_value
)
SELECT
  'cccccccc-0001-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'goog_camp_001', 'goog_ad_003',
  'Local Roofing Experts | 20yr Warranty',
  'RESPONSIVE_SEARCH_AD',
  'goog_ag_002', 'Branded – Phrase', d::date,
  ROUND((4 + random()::numeric * 4)::numeric, 2),
  (200 + floor(random()::numeric * 150))::int,
  (12  + floor(random()::numeric * 10))::int,
  ROUND((0.5 + random()::numeric * 1.5)::numeric, 4),
  ROUND((0.5 + random()::numeric * 1.5) * (320 + random()::numeric * 80)::numeric, 2)
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, ad_id, date) DO NOTHING;

INSERT INTO google_ads_ad_metrics (
  connection_id, client_id, campaign_id, ad_id, ad_name, ad_type,
  ad_group_id, ad_group_name, date,
  spend, impressions, clicks, conversions, conversions_value
)
SELECT
  'cccccccc-0001-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'goog_camp_002', 'goog_ad_004',
  'Switch From Competitor | Apex Roofing',
  'RESPONSIVE_SEARCH_AD',
  'goog_ag_003', 'Competitor – Generic', d::date,
  ROUND((20 + random()::numeric * 12)::numeric, 2),
  (1400 + floor(random()::numeric * 600))::int,
  (55   + floor(random()::numeric * 30))::int,
  ROUND((2 + random()::numeric * 3)::numeric, 4),
  ROUND((2 + random()::numeric * 3) * (290 + random()::numeric * 90)::numeric, 2)
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, ad_id, date) DO NOTHING;

INSERT INTO google_ads_ad_metrics (
  connection_id, client_id, campaign_id, ad_id, ad_name, ad_type,
  ad_group_id, ad_group_name, date,
  spend, impressions, clicks, conversions, conversions_value
)
SELECT
  'cccccccc-0001-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'goog_camp_002', 'goog_ad_005',
  'Better Than The Rest | Free Roof Quote',
  'EXPANDED_TEXT_AD',
  'goog_ag_003', 'Competitor – Generic', d::date,
  ROUND((15 + random()::numeric * 10)::numeric, 2),
  (1100 + floor(random()::numeric * 500))::int,
  (35   + floor(random()::numeric * 25))::int,
  ROUND((1 + random()::numeric * 3)::numeric, 4),
  ROUND((1 + random()::numeric * 3) * (300 + random()::numeric * 80)::numeric, 2)
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, ad_id, date) DO NOTHING;

INSERT INTO google_ads_ad_metrics (
  connection_id, client_id, campaign_id, ad_id, ad_name, ad_type,
  ad_group_id, ad_group_name, date,
  spend, impressions, clicks, conversions, conversions_value
)
SELECT
  'cccccccc-0001-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'goog_camp_003', 'goog_ad_006',
  'Apex Roofing – Retargeting Banner',
  'RESPONSIVE_DISPLAY_AD',
  'goog_ag_004', 'Retargeting – All Visitors', d::date,
  ROUND((8 + random()::numeric * 6)::numeric, 2),
  (12000 + floor(random()::numeric * 5000))::int,
  (20    + floor(random()::numeric * 20))::int,
  ROUND((0.5 + random()::numeric * 1.5)::numeric, 4),
  ROUND((0.5 + random()::numeric * 1.5) * (200 + random()::numeric * 100)::numeric, 2)
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, ad_id, date) DO NOTHING;

-- ── 8. Meta Ads ad-level metrics (4 ads, 30 days each) ───────────────────────
-- NOTE: meta_ads_ad_metrics requires client_id (NOT NULL). No ad_type column.

INSERT INTO meta_ads_ad_metrics (
  connection_id, client_id, campaign_id, ad_id, ad_name,
  adset_id, adset_name, date,
  spend, impressions, clicks,
  conversions, conversion_value,
  actions, action_values
)
SELECT
  'cccccccc-0002-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'meta_camp_001', 'meta_ad_001',
  'Roof damage? Get a FREE inspection this week',
  'meta_adset_001', 'Lead Gen – Homeowners 35-65', d::date,
  ROUND((22 + random()::numeric * 12)::numeric, 2),
  (4000 + floor(random()::numeric * 2000))::int,
  (65   + floor(random()::numeric * 40))::int,
  ROUND((3 + random()::numeric * 4)::numeric, 4),
  ROUND((3 + random()::numeric * 4) * (270 + random()::numeric * 80)::numeric, 2),
  '[{"action_type":"lead","value":"3"},{"action_type":"link_click","value":"65"}]'::jsonb,
  '[]'::jsonb
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, ad_id, date) DO NOTHING;

INSERT INTO meta_ads_ad_metrics (
  connection_id, client_id, campaign_id, ad_id, ad_name,
  adset_id, adset_name, date,
  spend, impressions, clicks,
  conversions, conversion_value,
  actions, action_values
)
SELECT
  'cccccccc-0002-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'meta_camp_001', 'meta_ad_002',
  'Video: Before & After Storm Damage Repairs',
  'meta_adset_001', 'Lead Gen – Homeowners 35-65', d::date,
  ROUND((23 + random()::numeric * 14)::numeric, 2),
  (4200 + floor(random()::numeric * 2200))::int,
  (55   + floor(random()::numeric * 40))::int,
  ROUND((2 + random()::numeric * 4)::numeric, 4),
  ROUND((2 + random()::numeric * 4) * (290 + random()::numeric * 70)::numeric, 2),
  '[{"action_type":"lead","value":"2"},{"action_type":"video_view","value":"1200"},{"action_type":"link_click","value":"55"}]'::jsonb,
  '[]'::jsonb
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, ad_id, date) DO NOTHING;

INSERT INTO meta_ads_ad_metrics (
  connection_id, client_id, campaign_id, ad_id, ad_name,
  adset_id, adset_name, date,
  spend, impressions, clicks,
  conversions, conversion_value,
  actions, action_values
)
SELECT
  'cccccccc-0002-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'meta_camp_002', 'meta_ad_003',
  'Storm Season Is Here – Protect Your Home',
  'meta_adset_002', 'Awareness – Broad 25-55', d::date,
  ROUND((12 + random()::numeric * 7)::numeric, 2),
  (14000 + floor(random()::numeric * 6000))::int,
  (35    + floor(random()::numeric * 25))::int,
  ROUND((0.5 + random()::numeric * 1.5)::numeric, 4),
  ROUND((0.5 + random()::numeric * 1.5) * (160 + random()::numeric * 80)::numeric, 2),
  '[{"action_type":"post_engagement","value":"450"},{"action_type":"link_click","value":"35"}]'::jsonb,
  '[]'::jsonb
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, ad_id, date) DO NOTHING;

INSERT INTO meta_ads_ad_metrics (
  connection_id, client_id, campaign_id, ad_id, ad_name,
  adset_id, adset_name, date,
  spend, impressions, clicks,
  conversions, conversion_value,
  actions, action_values
)
SELECT
  'cccccccc-0002-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'meta_camp_002', 'meta_ad_004',
  'Brand Video – The Apex Roofing Story',
  'meta_adset_002', 'Awareness – Broad 25-55', d::date,
  ROUND((8 + random()::numeric * 5)::numeric, 2),
  (11000 + floor(random()::numeric * 5000))::int,
  (25    + floor(random()::numeric * 20))::int,
  ROUND((0.2 + random()::numeric * 0.8)::numeric, 4),
  ROUND((0.2 + random()::numeric * 0.8) * (120 + random()::numeric * 80)::numeric, 2),
  '[{"action_type":"video_view","value":"2800"},{"action_type":"link_click","value":"25"}]'::jsonb,
  '[]'::jsonb
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, ad_id, date) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 023_cleanup.sql
-- ═══════════════════════════════════════════════════════════════
-- 023_cleanup.sql
-- 1. Remove all dummy data from migration 022 (Apex Roofing demo).
-- 2. Add a UNIQUE constraint on connectors(type) so only one connector per
--    platform exists and the OAuth upserts work correctly.

-- ── Remove dummy metrics (must go first due to FKs) ─────────────────────────
DELETE FROM google_ads_ad_metrics
  WHERE connection_id = 'cccccccc-0001-0000-0000-000000000001';

DELETE FROM meta_ads_ad_metrics
  WHERE connection_id = 'cccccccc-0002-0000-0000-000000000001';

DELETE FROM google_ads_metrics
  WHERE connection_id = 'cccccccc-0001-0000-0000-000000000001';

DELETE FROM meta_ads_metrics
  WHERE connection_id = 'cccccccc-0002-0000-0000-000000000001';

-- ── Remove dummy campaign assignments ────────────────────────────────────────
DELETE FROM client_campaign_assignments
  WHERE client_id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- ── Remove dummy client connections ─────────────────────────────────────────
DELETE FROM client_connections
  WHERE id IN (
    'cccccccc-0001-0000-0000-000000000001',
    'cccccccc-0002-0000-0000-000000000001'
  );

-- ── Remove cached connector accounts for dummy connectors ────────────────────
DELETE FROM connector_accounts
  WHERE connector_id IN (
    'bbbbbbbb-0001-0000-0000-000000000001',
    'bbbbbbbb-0002-0000-0000-000000000001'
  );

-- ── Remove dummy connectors ──────────────────────────────────────────────────
DELETE FROM connectors
  WHERE id IN (
    'bbbbbbbb-0001-0000-0000-000000000001',
    'bbbbbbbb-0002-0000-0000-000000000001'
  );

-- ── Remove demo client ───────────────────────────────────────────────────────
DELETE FROM clients
  WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- ── Remove any other duplicate connectors per type (keep the most recent) ────
-- This handles the case where multiple connectors of the same type were
-- accidentally created before the unique constraint existed.
DELETE FROM connectors
  WHERE id NOT IN (
    SELECT DISTINCT ON (type) id
    FROM connectors
    ORDER BY type, created_at DESC
  );

-- ── Add unique constraint so each platform type can only have one connector ──
-- This makes the OAuth upsert (onConflict: 'type') work correctly.
ALTER TABLE connectors
  ADD CONSTRAINT connectors_type_unique UNIQUE (type);

-- ═══════════════════════════════════════════════════════════════
-- 024_force_clear_dummy_connector.sql
-- ═══════════════════════════════════════════════════════════════
-- 024_force_clear_dummy_connector.sql
-- Forcefully removes the stale dummy Meta Ads connector (bbbbbbbb-0002-…)
-- that migration 023 may not have cleaned up if it was partially applied.
-- Safe to run even if the row is already gone (DELETE is idempotent).

-- Remove in FK order: metrics → ad metrics → assignments → connections → accounts → connector

DELETE FROM meta_ads_ad_metrics
  WHERE connection_id = 'cccccccc-0002-0000-0000-000000000001';

DELETE FROM meta_ads_metrics
  WHERE connection_id = 'cccccccc-0002-0000-0000-000000000001';

DELETE FROM google_ads_ad_metrics
  WHERE connection_id = 'cccccccc-0001-0000-0000-000000000001';

DELETE FROM google_ads_metrics
  WHERE connection_id = 'cccccccc-0001-0000-0000-000000000001';

DELETE FROM client_campaign_assignments
  WHERE client_id = 'aaaaaaaa-0000-0000-0000-000000000001';

DELETE FROM client_connections
  WHERE id IN (
    'cccccccc-0001-0000-0000-000000000001',
    'cccccccc-0002-0000-0000-000000000001'
  );

DELETE FROM connector_accounts
  WHERE connector_id IN (
    'bbbbbbbb-0001-0000-0000-000000000001',
    'bbbbbbbb-0002-0000-0000-000000000001'
  );

DELETE FROM connectors
  WHERE id IN (
    'bbbbbbbb-0001-0000-0000-000000000001',
    'bbbbbbbb-0002-0000-0000-000000000001'
  );

DELETE FROM clients
  WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- Ensure the unique constraint exists (no-op if already added by 023)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'connectors_type_unique'
  ) THEN
    ALTER TABLE connectors ADD CONSTRAINT connectors_type_unique UNIQUE (type);
  END IF;
END$$;

-- ═══════════════════════════════════════════════════════════════
-- 025_expanded_creative.sql
-- ═══════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 025: Expanded creative fields for ad-level metrics
--
-- Google Ads: adds headlines, descriptions, final_url, image_url, ad_strength
-- Meta Ads:   adds image_url (high-res), video fields, creative copy fields
--             also adds ad_status for delivery state
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Google Ads ad-level creative ─────────────────────────────────────────────

ALTER TABLE google_ads_ad_metrics
  ADD COLUMN IF NOT EXISTS headlines     JSONB,        -- ["Headline 1", "Headline 2", ...]
  ADD COLUMN IF NOT EXISTS descriptions  JSONB,        -- ["Description 1", ...]
  ADD COLUMN IF NOT EXISTS final_url     TEXT,         -- first entry from final_urls array
  ADD COLUMN IF NOT EXISTS image_url     TEXT,         -- image_ad.image_url for image ads
  ADD COLUMN IF NOT EXISTS ad_strength   TEXT,         -- EXCELLENT | GOOD | AVERAGE | POOR | PENDING | UNSPECIFIED
  ADD COLUMN IF NOT EXISTS ad_status     TEXT;         -- ENABLED | PAUSED | REMOVED

-- ── Meta Ads ad-level creative ────────────────────────────────────────────────

ALTER TABLE meta_ads_ad_metrics
  ADD COLUMN IF NOT EXISTS image_url         TEXT,     -- full-size creative image
  ADD COLUMN IF NOT EXISTS video_id          TEXT,     -- Meta video asset ID
  ADD COLUMN IF NOT EXISTS video_thumb_url   TEXT,     -- video poster/thumbnail
  ADD COLUMN IF NOT EXISTS creative_body     TEXT,     -- primary ad copy text
  ADD COLUMN IF NOT EXISTS creative_title    TEXT,     -- ad headline
  ADD COLUMN IF NOT EXISTS creative_link_url TEXT,     -- destination / link URL
  ADD COLUMN IF NOT EXISTS ad_status         TEXT;     -- ACTIVE | PAUSED | DELETED

-- Update the unique constraint comment (no DDL change needed — existing unique index is fine)
-- ═══════════════════════════════════════════════════════════════
-- 026_storage_bucket_and_conversion.sql
-- ═══════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 026: Storage bucket + conversion mapping fields
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Create the uploads storage bucket ────────────────────────────────────────
-- This is idempotent — safe to re-run.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'uploads',
  'uploads',
  true,
  4194304,  -- 4 MB
  ARRAY['image/jpeg','image/png','image/gif','image/webp','image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public            = EXCLUDED.public,
  file_size_limit   = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Allow anyone to read public objects (for logo display in client dashboards)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'Public uploads read'
  ) THEN
    CREATE POLICY "Public uploads read"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'uploads');
  END IF;
END $$;

-- Allow service role to insert (our API uses service-role key)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'Service role uploads insert'
  ) THEN
    CREATE POLICY "Service role uploads insert"
      ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'uploads');
  END IF;
END $$;

-- ── Conversion mapping on agency_settings ────────────────────────────────────
-- Global defaults for which Meta action type counts as a lead or purchase.
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS default_lead_action     TEXT DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS default_purchase_action TEXT DEFAULT 'purchase';

-- ── Per-client conversion mapping overrides ───────────────────────────────────
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS lead_action     TEXT,  -- NULL = use agency default
  ADD COLUMN IF NOT EXISTS purchase_action TEXT;  -- NULL = use agency default

-- ═══════════════════════════════════════════════════════════════
-- 027_campaign_display_mode.sql
-- ═══════════════════════════════════════════════════════════════
-- 027_campaign_display_mode.sql
--
-- Add display_mode and conversion_label directly to client_campaign_assignments,
-- replacing the indirect category → display_mode relationship.
-- Admins now toggle Ecom / Lead Gen per campaign in the client settings page.
-- The campaign_categories table is left intact for backward compat but
-- is no longer used for display logic.

ALTER TABLE client_campaign_assignments
  ADD COLUMN IF NOT EXISTS display_mode TEXT NOT NULL DEFAULT 'lead_gen';

ALTER TABLE client_campaign_assignments
  ADD COLUMN IF NOT EXISTS conversion_label TEXT;

-- Migrate any existing category-based display_mode to the new column
UPDATE client_campaign_assignments cca
SET
  display_mode     = COALESCE(cc.display_mode, 'lead_gen'),
  conversion_label = cc.conversion_label
FROM campaign_categories cc
WHERE cca.category_id = cc.id
  AND cca.category_id IS NOT NULL;

-- Index for fast lookup by client + source
CREATE INDEX IF NOT EXISTS idx_cca_client_source
  ON client_campaign_assignments (client_id, source);

-- ═══════════════════════════════════════════════════════════════
-- 028_ensure_ad_level_columns.sql
-- ═══════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 028: Ensure ad-level creative columns exist
--
-- Safe to run multiple times (ADD COLUMN IF NOT EXISTS).
-- Fixes databases that were set up before migration 025 was applied.
-- These columns are required by upsertGoogleAdsAdMetrics in sync.ts.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Google Ads: creative columns added in 025 ────────────────────────────────
ALTER TABLE google_ads_ad_metrics
  ADD COLUMN IF NOT EXISTS headlines     JSONB,
  ADD COLUMN IF NOT EXISTS descriptions  JSONB,
  ADD COLUMN IF NOT EXISTS final_url     TEXT,
  ADD COLUMN IF NOT EXISTS image_url     TEXT,
  ADD COLUMN IF NOT EXISTS ad_strength   TEXT,
  ADD COLUMN IF NOT EXISTS ad_status     TEXT;

-- ── Meta Ads: creative columns added in 025 ──────────────────────────────────
ALTER TABLE meta_ads_ad_metrics
  ADD COLUMN IF NOT EXISTS image_url         TEXT,
  ADD COLUMN IF NOT EXISTS video_id          TEXT,
  ADD COLUMN IF NOT EXISTS video_thumb_url   TEXT,
  ADD COLUMN IF NOT EXISTS creative_body     TEXT,
  ADD COLUMN IF NOT EXISTS creative_title    TEXT,
  ADD COLUMN IF NOT EXISTS creative_link_url TEXT,
  ADD COLUMN IF NOT EXISTS ad_status         TEXT;

-- ═══════════════════════════════════════════════════════════════
-- 029_asset_group_assets.sql
-- ═══════════════════════════════════════════════════════════════
-- Migration 029: Google Ads pMax asset group assets
-- Stores individual creative assets (images, headlines, descriptions, videos)
-- for Performance Max campaign asset groups.

CREATE TABLE IF NOT EXISTS google_ads_asset_group_assets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id    UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id)           ON DELETE CASCADE,
  campaign_id      TEXT NOT NULL,
  campaign_name    TEXT,
  asset_group_id   TEXT NOT NULL,
  asset_group_name TEXT,
  asset_id         TEXT NOT NULL,
  field_type       TEXT NOT NULL,   -- HEADLINE, DESCRIPTION, MARKETING_IMAGE, LOGO, YOUTUBE_VIDEO, etc.
  text_content     TEXT,            -- populated for text assets (HEADLINE, DESCRIPTION, BUSINESS_NAME, etc.)
  image_url        TEXT,            -- populated for image / logo assets
  video_id         TEXT,            -- YouTube video ID for video assets
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (connection_id, asset_group_id, asset_id, field_type)
);

CREATE INDEX IF NOT EXISTS idx_gads_aga_client_group
  ON google_ads_asset_group_assets(client_id, asset_group_id);

CREATE INDEX IF NOT EXISTS idx_gads_aga_connection
  ON google_ads_asset_group_assets(connection_id);

-- ═══════════════════════════════════════════════════════════════
-- 030_google_ads_keywords.sql
-- ═══════════════════════════════════════════════════════════════
-- Migration 030: Google Ads keyword-level metrics
-- Stores daily keyword performance for Search campaigns.
-- Unique on (connection_id, keyword_id, date) so incremental syncs upsert cleanly.

CREATE TABLE IF NOT EXISTS google_ads_keywords (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id     UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id         UUID NOT NULL REFERENCES clients(id)           ON DELETE CASCADE,
  campaign_id       TEXT NOT NULL,
  campaign_name     TEXT,
  ad_group_id       TEXT NOT NULL,
  ad_group_name     TEXT,
  keyword_id        TEXT NOT NULL,
  keyword_text      TEXT NOT NULL,
  match_type        TEXT,           -- BROAD | PHRASE | EXACT
  keyword_status    TEXT,
  spend             NUMERIC(12,6)  NOT NULL DEFAULT 0,
  impressions       INT            NOT NULL DEFAULT 0,
  clicks            INT            NOT NULL DEFAULT 0,
  conversions       NUMERIC(10,2)  NOT NULL DEFAULT 0,
  conversions_value NUMERIC(12,2)  NOT NULL DEFAULT 0,
  date              DATE           NOT NULL,
  synced_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  UNIQUE (connection_id, keyword_id, date)
);

CREATE INDEX IF NOT EXISTS idx_gads_kw_client_campaign
  ON google_ads_keywords(client_id, campaign_id, ad_group_id, date);

CREATE INDEX IF NOT EXISTS idx_gads_kw_connection
  ON google_ads_keywords(connection_id);

-- ═══════════════════════════════════════════════════════════════
-- 031_google_ads_negative_keywords.sql
-- ═══════════════════════════════════════════════════════════════
-- Migration 031: Google Ads negative keywords (campaign-level + ad-group-level)
-- Not date-segmented — represents the current active negative keyword set.
-- Re-synced on every sync run (non-dated snapshot, upsert on conflict).

CREATE TABLE IF NOT EXISTS google_ads_negative_keywords (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id  UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id      UUID NOT NULL REFERENCES clients(id)           ON DELETE CASCADE,
  campaign_id    TEXT NOT NULL,
  campaign_name  TEXT,
  ad_group_id    TEXT,         -- NULL for campaign-level negatives
  ad_group_name  TEXT,
  keyword_id     TEXT NOT NULL,
  keyword_text   TEXT NOT NULL,
  match_type     TEXT,         -- BROAD | PHRASE | EXACT
  level          TEXT NOT NULL DEFAULT 'campaign',  -- 'campaign' | 'adgroup'
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (connection_id, keyword_id, level)
);

CREATE INDEX IF NOT EXISTS idx_gads_neg_kw_client_campaign
  ON google_ads_negative_keywords(client_id, campaign_id);

CREATE INDEX IF NOT EXISTS idx_gads_neg_kw_adgroup
  ON google_ads_negative_keywords(client_id, campaign_id, ad_group_id)
  WHERE ad_group_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- 032_chart_colors.sql
-- ═══════════════════════════════════════════════════════════════
-- Chart color customisation columns for agency_settings
-- These control the 4 series colors shown in SpendChart on all dashboards.

ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS chart_color_spend             text DEFAULT '#93c5fd',
  ADD COLUMN IF NOT EXISTS chart_color_prior_spend       text DEFAULT '#94a3b8',
  ADD COLUMN IF NOT EXISTS chart_color_conversions       text DEFAULT '#059669',
  ADD COLUMN IF NOT EXISTS chart_color_prior_conversions text DEFAULT '#34d399';

-- ═══════════════════════════════════════════════════════════════
-- 033_client_show_benchmarks.sql
-- ═══════════════════════════════════════════════════════════════
-- Add show_benchmarks toggle to clients table.
-- When true, the performance benchmarks section is visible on that client's dashboard.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS show_benchmarks BOOLEAN DEFAULT false;

-- ═══════════════════════════════════════════════════════════════
-- 034_client_hidden_metrics.sql
-- ═══════════════════════════════════════════════════════════════
-- Migration 034: Add hidden_metrics array to clients
-- Allows admins to control which metric cards are shown on the client dashboard.
-- Metric IDs: spend, leads, cpl, roas, ctr, conv_rate, cpm, daily_chart, campaigns

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS hidden_metrics TEXT[] DEFAULT '{}';

-- ═══════════════════════════════════════════════════════════════
-- 035_ghl_connector.sql
-- ═══════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════
-- 036_conversion_fallback_ai.sql
-- ═══════════════════════════════════════════════════════════════
-- 036: Conversion action fallback + AI defaults
-- Adds secondary (fallback) conversion action fields for Meta campaigns.
-- When the primary action type isn't found for a campaign/ad/adset,
-- the dashboard falls back to the secondary action type.
-- Also updates AI defaults to OpenAI.

-- Agency-level fallback actions
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS default_lead_action_fallback     TEXT DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS default_purchase_action_fallback TEXT;

-- Client-level fallback overrides (NULL = use agency default)
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS lead_action_fallback     TEXT,
  ADD COLUMN IF NOT EXISTS purchase_action_fallback TEXT;

-- Update agency default primary lead action to the more accurate grouped type
-- Only update if still set to the old default
UPDATE agency_settings
  SET default_lead_action = 'onsite_conversion.lead_grouped'
  WHERE default_lead_action = 'lead' OR default_lead_action IS NULL;

-- Update AI defaults to OpenAI (cheaper for content generation)
UPDATE agency_settings
  SET ai_provider = 'openai',
      ai_model    = 'gpt-4o'
  WHERE ai_provider = 'anthropic' OR ai_provider IS NULL;

-- ═══════════════════════════════════════════════════════════════
-- 037_meta_campaign_status.sql
-- ═══════════════════════════════════════════════════════════════
-- 037_meta_campaign_status.sql
-- Add campaign_status column to meta_ads_metrics.
-- Meta campaigns have statuses (ACTIVE, PAUSED, ARCHIVED, DELETED) but the field
-- was previously not requested from the API. This migration adds the column so
-- the sync engine can persist it and the UI can show status badges for Meta campaigns.

ALTER TABLE meta_ads_metrics
  ADD COLUMN IF NOT EXISTS campaign_status TEXT;

-- Partial index for active/paused filtering queries
CREATE INDEX IF NOT EXISTS idx_meta_metrics_campaign_status
  ON meta_ads_metrics(client_id, campaign_status)
  WHERE campaign_status IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- 038_ga4_metrics.sql
-- ═══════════════════════════════════════════════════════════════
-- 038_ga4_metrics.sql
-- Google Analytics 4 daily metrics table.
-- Stores sessions, users, page views, conversions, bounce rate, and avg session
-- duration per day per connection. Channel group dimension enables breakdown by
-- traffic source (organic, paid, direct, social, etc.).

CREATE TABLE IF NOT EXISTS ga4_metrics (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id         UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date                  DATE NOT NULL,
  channel_group         TEXT,             -- sessionDefaultChannelGroup dimension (NULL = aggregate row)
  sessions              INT DEFAULT 0,
  users                 INT DEFAULT 0,
  new_users             INT DEFAULT 0,
  page_views            INT DEFAULT 0,
  conversions           INT DEFAULT 0,
  bounce_rate           NUMERIC(6,4),
  avg_session_duration  NUMERIC(10,2),    -- seconds
  raw_data              JSONB,
  synced_at             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(connection_id, date, channel_group)
);

CREATE INDEX IF NOT EXISTS idx_ga4_client_date
  ON ga4_metrics(client_id, date);

CREATE INDEX IF NOT EXISTS idx_ga4_connection_date
  ON ga4_metrics(connection_id, date);

-- ═══════════════════════════════════════════════════════════════
-- 039_gsc_metrics.sql
-- ═══════════════════════════════════════════════════════════════
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
  synced_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gsc_unique_row
  ON gsc_metrics(connection_id, date, COALESCE(query, ''), COALESCE(page, ''), COALESCE(country, ''));

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

-- ═══════════════════════════════════════════════════════════════
-- 040_gbp_metrics.sql
-- ═══════════════════════════════════════════════════════════════
-- 040_gbp_metrics.sql
-- Google Business Profile daily performance metrics.
-- Stores views (search + maps), clicks, calls, directions, photos, and
-- review summary per location per day. Supports clients with multiple locations.

CREATE TABLE IF NOT EXISTS gbp_metrics (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id       UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date                DATE NOT NULL,
  location_id         TEXT NOT NULL,      -- GBP location resource name
  location_name       TEXT,               -- human-readable location name
  views_search        INT DEFAULT 0,      -- impressions on Google Search
  views_maps          INT DEFAULT 0,      -- impressions on Google Maps
  website_clicks      INT DEFAULT 0,
  call_clicks         INT DEFAULT 0,
  direction_clicks    INT DEFAULT 0,
  photos_views        INT DEFAULT 0,
  photos_count        INT DEFAULT 0,
  reviews_count       INT DEFAULT 0,
  reviews_avg_rating  NUMERIC(3,2),       -- 1.0 to 5.0
  raw_data            JSONB,
  synced_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(connection_id, location_id, date)
);

CREATE INDEX IF NOT EXISTS idx_gbp_client_date
  ON gbp_metrics(client_id, date);

CREATE INDEX IF NOT EXISTS idx_gbp_location
  ON gbp_metrics(client_id, location_id, date);

-- ═══════════════════════════════════════════════════════════════
-- 041_daily_budget.sql
-- ═══════════════════════════════════════════════════════════════
-- 041_daily_budget.sql
-- Add daily_budget column to google_ads_metrics and meta_ads_metrics.
-- Stores the campaign's daily budget at the time of sync (in account currency).
-- Google Ads: campaign.campaign_budget.amount_micros / 1_000_000
-- Meta Ads:   daily_budget field from Campaigns API (in account currency cents / 100)

ALTER TABLE google_ads_metrics
  ADD COLUMN IF NOT EXISTS daily_budget DECIMAL(12,4);

ALTER TABLE meta_ads_metrics
  ADD COLUMN IF NOT EXISTS daily_budget DECIMAL(12,4);

-- ═══════════════════════════════════════════════════════════════
-- 042_fix_wordpress_connector_unique.sql
-- ═══════════════════════════════════════════════════════════════
-- Migration 042: Fix WordPress connector unique constraint
-- The previous UNIQUE(type) constraint on connectors prevented adding multiple
-- WordPress sites (one per client). WordPress and GHL are per-site connectors
-- and need multiple rows. Only OAuth connectors (google_ads, meta_ads, etc.)
-- are truly singletons at the agency level.

-- Drop the overly-broad global unique constraint
ALTER TABLE connectors DROP CONSTRAINT IF EXISTS connectors_type_unique;
DROP INDEX IF EXISTS connectors_type_unique;

-- Re-add uniqueness only for singleton connector types
CREATE UNIQUE INDEX IF NOT EXISTS connectors_singleton_type_unique
  ON connectors (type)
  WHERE type IN ('google_ads', 'meta_ads', 'google_analytics', 'google_search_console');

-- Add impression share columns to google_ads_metrics
ALTER TABLE google_ads_metrics
  ADD COLUMN IF NOT EXISTS search_impression_share         DECIMAL(5,4),
  ADD COLUMN IF NOT EXISTS search_abs_top_impression_share DECIMAL(5,4),
  ADD COLUMN IF NOT EXISTS search_top_impression_share     DECIMAL(5,4);

-- ═══════════════════════════════════════════════════════════════
-- 043_ahrefs.sql
-- ═══════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════
-- 044_content_automation.sql
-- ═══════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- 044: Content Automation — scheduled AI post generation queue
-- ─────────────────────────────────────────────────────────────────────────────

-- Global and per-client content settings
-- client_id = NULL means the row is the global default.
CREATE TABLE IF NOT EXISTS content_settings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  -- Client background context (injected into AI system prompt)
  business_background TEXT,
  services            TEXT,
  target_audience     TEXT,
  geographic_focus    TEXT,
  brand_voice         TEXT,
  sitemap_url         TEXT,   -- for context-aware internal linking hints
  -- Global content structure template (overrides agency global when set per-client)
  post_structure      TEXT,
  -- Scheduling
  auto_generate       BOOLEAN NOT NULL DEFAULT FALSE,
  cron_schedule       TEXT NOT NULL DEFAULT '0 6 * * 1',  -- weekly Monday 6am UTC
  posts_per_run       INT  NOT NULL DEFAULT 1 CHECK (posts_per_run BETWEEN 1 AND 10),
  -- WordPress publishing defaults
  connection_id       UUID REFERENCES client_connections(id) ON DELETE SET NULL,
  default_author_id   INT,    -- WP user ID
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Global default row (client_id = NULL)
-- Only one such row may exist; enforced by the UNIQUE(client_id) constraint
-- (NULL is treated as unique in Postgres partial index, handled by app upsert logic).

-- Content post queue
CREATE TABLE IF NOT EXISTS content_posts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  connection_id       UUID REFERENCES client_connections(id) ON DELETE SET NULL,
  -- Workflow status
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected','published','draft_saved')),
  -- Topic targeting
  target_keyword      TEXT,
  secondary_keywords  TEXT,
  focus_topic         TEXT,
  -- Generated content
  title               TEXT,
  content             TEXT,   -- HTML body
  meta_description    TEXT,
  slug                TEXT,
  -- SEO signals (computed on save)
  word_count          INT,
  heading_count       INT,    -- number of H2/H3 headings
  internal_links      INT,    -- number of internal <a> tags in content
  -- WordPress publishing
  wp_post_id          INT,
  wp_author_id        INT,
  wp_status           TEXT,   -- draft | publish
  published_url       TEXT,
  -- Generation provenance
  generated_by        TEXT NOT NULL DEFAULT 'scheduled'
                        CHECK (generated_by IN ('scheduled','manual')),
  ai_model            TEXT,
  prompt_used         TEXT,
  edit_notes          TEXT,   -- instructions given for AI re-edit
  -- Timestamps
  generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at         TIMESTAMPTZ,
  published_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_content_posts_client
  ON content_posts(client_id, status);

CREATE INDEX IF NOT EXISTS idx_content_posts_status
  ON content_posts(status, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_posts_client_date
  ON content_posts(client_id, generated_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- 045_sync_triggered_by.sql
-- ═══════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- 045: Add triggered_by to sync_jobs
-- ─────────────────────────────────────────────────────────────────────────────
-- Records who triggered each sync: cron job, admin user, or system backfill.
-- Nullable so existing rows display as '—' without a backfill.

ALTER TABLE sync_jobs
  ADD COLUMN IF NOT EXISTS triggered_by TEXT
  CHECK (triggered_by IN ('cron', 'admin', 'system'));

-- ═══════════════════════════════════════════════════════════════
-- 046_content_settings_v2.sql
-- ═══════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- 046: Content Settings v2 — flexible scheduling + target length
-- ─────────────────────────────────────────────────────────────────────────────

-- Replace the raw cron_schedule string with user-friendly frequency fields.
-- schedule_frequency: how often to generate
-- schedule_day_of_week: which day (0=Sun … 6=Sat); relevant for weekly/biweekly
-- target_length: approximate word count target for generated posts

ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS schedule_frequency    TEXT    NOT NULL DEFAULT 'weekly'
    CHECK (schedule_frequency IN ('daily', 'weekly', 'biweekly', 'monthly')),
  ADD COLUMN IF NOT EXISTS schedule_day_of_week  INT     DEFAULT 1
    CHECK (schedule_day_of_week BETWEEN 0 AND 6),
  ADD COLUMN IF NOT EXISTS target_length         INT     NOT NULL DEFAULT 1500
    CHECK (target_length BETWEEN 300 AND 5000);

-- cron_schedule column is kept for backwards compatibility but no longer used by the app.

-- ═══════════════════════════════════════════════════════════════
-- 047_benchmark_cpl_visibility.sql
-- ═══════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- 047: Per-benchmark visibility + CPL benchmark target
-- ─────────────────────────────────────────────────────────────────────────────

-- Add CPL benchmark target to global agency settings
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS benchmark_cpl NUMERIC DEFAULT 50;

-- Add CPL benchmark override to per-client benchmarks
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS benchmark_cpl NUMERIC;

-- Which benchmarks are shown in the benchmark panel and admin health cards.
-- NULL = not configured (use legacy heuristic: ROAS only for ecom clients).
-- When set, only the listed keys are shown.
-- Valid keys: roas, ctr, cpc, conv_rate, cpm, cpl
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS enabled_benchmarks TEXT[];

-- ═══════════════════════════════════════════════════════════════
-- 048_content_seo_fields.sql
-- ═══════════════════════════════════════════════════════════════
-- Migration 048: Content SEO fields
-- Adds phone_number to content_settings for injection into AI generation prompts.
-- Adds seo_title and suggested_tags to content_posts for Rank Math SEO integration.

ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS phone_number TEXT;

ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS seo_title TEXT,
  ADD COLUMN IF NOT EXISTS suggested_tags TEXT[];

-- ═══════════════════════════════════════════════════════════════
-- 049_content_topics.sql
-- ═══════════════════════════════════════════════════════════════
-- Migration 049: Content Topics workflow + agency_settings notification fields
-- Adds content_topics table for AI-driven topic planning with scheduled publish dates.
-- Also adds notification and overview_columns fields to agency_settings.

-- ── content_topics ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_topics (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  topic                TEXT        NOT NULL,
  rationale            TEXT,                         -- why this topic / which GSC gap it fills
  target_keyword       TEXT,
  status               TEXT        NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'approved', 'rejected', 'generating', 'generated')),
  target_publish_date  DATE,                         -- set by admin when approving
  generate_by_date     DATE GENERATED ALWAYS AS (target_publish_date - INTERVAL '7 days') STORED,
  post_id              UUID        REFERENCES content_posts(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_topics_client_id_idx ON content_topics(client_id);
CREATE INDEX IF NOT EXISTS content_topics_status_idx    ON content_topics(status);

-- ── content_posts: add scheduled publish fields ───────────────────────────────
ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS scheduled_publish_date DATE,
  ADD COLUMN IF NOT EXISTS auto_publish            BOOLEAN NOT NULL DEFAULT false;

-- ── agency_settings: notification + overview columns ─────────────────────────
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS notification_email      TEXT,
  ADD COLUMN IF NOT EXISTS notify_topics_created   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_post_generated   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_approval_needed  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS overview_columns        JSONB;

-- ═══════════════════════════════════════════════════════════════
-- 050_phase10.sql
-- ═══════════════════════════════════════════════════════════════
-- Migration 050: Phase 10 — sync schedule, content scheduling, topics status

-- ── content_settings: per-client monthly publish schedule ────────────────────
ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS monthly_publish_day INT
    CHECK (monthly_publish_day BETWEEN 1 AND 28),         -- day of month (1–28) to auto-publish
  ADD COLUMN IF NOT EXISTS topics_per_run      INT NOT NULL DEFAULT 5,  -- how many topics to generate per cycle
  ADD COLUMN IF NOT EXISTS weeks_ahead         INT NOT NULL DEFAULT 4;  -- how far ahead to set target_publish_date

-- ── content_topics: add 'scheduled' status ───────────────────────────────────
-- Drop existing check constraint and recreate with the new status value
ALTER TABLE content_topics
  DROP CONSTRAINT IF EXISTS content_topics_status_check;
ALTER TABLE content_topics
  ADD CONSTRAINT content_topics_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'generating', 'generated', 'scheduled'));

-- ── agency_settings: sync schedule fields ────────────────────────────────────
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS sync_frequency    TEXT NOT NULL DEFAULT 'daily'
    CHECK (sync_frequency IN ('hourly', 'every6h', 'every12h', 'daily', 'weekly')),
  ADD COLUMN IF NOT EXISTS sync_hour_utc     INT  NOT NULL DEFAULT 6
    CHECK (sync_hour_utc BETWEEN 0 AND 23),
  ADD COLUMN IF NOT EXISTS sync_day_of_week  INT
    CHECK (sync_day_of_week BETWEEN 0 AND 6),              -- NULL = not weekly
  ADD COLUMN IF NOT EXISTS notify_schedule_generated BOOLEAN NOT NULL DEFAULT true;

-- ═══════════════════════════════════════════════════════════════
-- 051_fix_google_connector_unique.sql
-- ═══════════════════════════════════════════════════════════════
-- Migration 051: Extend singleton-type unique index to cover google_business_profile and ahrefs
--
-- Migration 042 created a partial unique index for singleton connector types but omitted
-- google_business_profile and ahrefs (added later in migrations 043+). Without this index
-- entry, the uniqueness constraint is not enforced for those types, which could lead to
-- duplicate connector rows.
--
-- Note: application code in /api/auth/google/callback uses explicit UPDATE/INSERT by PK
-- rather than ON CONFLICT (type), so this index is only for data-integrity enforcement —
-- it does not need to be used as an ON CONFLICT inference target.

DROP INDEX IF EXISTS connectors_singleton_type_unique;

CREATE UNIQUE INDEX IF NOT EXISTS connectors_singleton_type_unique
  ON connectors (type)
  WHERE type IN (
    'google_ads',
    'meta_ads',
    'google_analytics',
    'google_search_console',
    'google_business_profile',
    'ahrefs'
  );

-- ═══════════════════════════════════════════════════════════════
-- 052_fix_gsc_ga4_unique.sql
-- ═══════════════════════════════════════════════════════════════
-- Migration 052: Fix unique constraints on gsc_metrics and ga4_metrics
--
-- gsc_metrics: The original unique index used COALESCE expressions which cannot
-- be used as an ON CONFLICT inference target with plain column names. Every
-- upsert was silently failing. Fix: make query/page/country NOT NULL with
-- default '' and replace the expression index with a plain UNIQUE index.
--
-- ga4_metrics: The table was created before channel_group was added to the
-- schema, so CREATE TABLE IF NOT EXISTS silently skipped it. The column is
-- missing, which causes every upsert to fail. Fix: add the column and the
-- UNIQUE constraint if they don't already exist.

-- ── gsc_metrics ───────────────────────────────────────────────────────────────

UPDATE gsc_metrics SET
  query   = COALESCE(query,   ''),
  page    = COALESCE(page,    ''),
  country = COALESCE(country, '')
WHERE query IS NULL OR page IS NULL OR country IS NULL;

ALTER TABLE gsc_metrics
  ALTER COLUMN query   SET DEFAULT '',
  ALTER COLUMN page    SET DEFAULT '',
  ALTER COLUMN country SET DEFAULT '';

ALTER TABLE gsc_metrics
  ALTER COLUMN query   SET NOT NULL,
  ALTER COLUMN page    SET NOT NULL,
  ALTER COLUMN country SET NOT NULL;

DROP INDEX IF EXISTS idx_gsc_unique_row;

CREATE UNIQUE INDEX idx_gsc_unique_row
  ON gsc_metrics(connection_id, date, query, page, country);

-- ── ga4_metrics ───────────────────────────────────────────────────────────────

-- Add channel_group if it was missing (table pre-dated migration 038's full schema)
ALTER TABLE ga4_metrics
  ADD COLUMN IF NOT EXISTS channel_group TEXT NOT NULL DEFAULT 'Direct';

-- Add the UNIQUE constraint only if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'ga4_metrics'::regclass
      AND contype = 'u'
      AND conname = 'ga4_metrics_connection_id_date_channel_group_key'
  ) THEN
    ALTER TABLE ga4_metrics
      ADD CONSTRAINT ga4_metrics_connection_id_date_channel_group_key
      UNIQUE (connection_id, date, channel_group);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 053_fix_ga4_channel_group.sql
-- ═══════════════════════════════════════════════════════════════
-- Migration 053: Robustly fix ga4_metrics channel_group constraint
--
-- Problem: Migration 052 used ADD COLUMN IF NOT EXISTS which is a no-op when
-- the column already existed (from migration 038) as a nullable TEXT column.
-- The column stays nullable, potentially has NULL rows, and the upsert's
-- onConflict: 'connection_id,date,channel_group' fails because the existing
-- UNIQUE constraint may not have the expected name.
--
-- This migration handles all cases regardless of current DB state:
--   Case A: column was added by migration 052 (NOT NULL, DEFAULT 'Direct')
--   Case B: column existed from migration 038 (nullable TEXT, no default)

-- Backfill any NULL channel_group values to 'Direct'
UPDATE ga4_metrics SET channel_group = 'Direct' WHERE channel_group IS NULL;

-- Ensure column has NOT NULL constraint and DEFAULT (safe no-op if already set)
ALTER TABLE ga4_metrics ALTER COLUMN channel_group SET DEFAULT 'Direct';
ALTER TABLE ga4_metrics ALTER COLUMN channel_group SET NOT NULL;

-- Drop the UNIQUE constraint (whichever name it has) and recreate with the
-- exact name that the upsert's onConflict: 'connection_id,date,channel_group' targets.
ALTER TABLE ga4_metrics
  DROP CONSTRAINT IF EXISTS ga4_metrics_connection_id_date_channel_group_key;

ALTER TABLE ga4_metrics
  ADD CONSTRAINT ga4_metrics_connection_id_date_channel_group_key
  UNIQUE (connection_id, date, channel_group);

-- ═══════════════════════════════════════════════════════════════
-- 054_drop_ga4_old_unique.sql
-- ═══════════════════════════════════════════════════════════════
-- Migration 054: Drop old GA4 unique constraint
--
-- Migration 053 correctly added the (connection_id, date, channel_group) constraint
-- but did NOT drop the old (connection_id, date) constraint that was created by
-- the original table setup. That old constraint blocks upserts when multiple
-- channel_group rows (e.g. "Organic Search", "Direct", "Paid Search") share the
-- same connection_id + date combination.
--
-- Error seen in logs:
--   duplicate key value violates unique constraint "ga4_metrics_connection_id_date_key"

ALTER TABLE ga4_metrics DROP CONSTRAINT IF EXISTS ga4_metrics_connection_id_date_key;

-- ═══════════════════════════════════════════════════════════════
-- 055_metric_layouts.sql
-- ═══════════════════════════════════════════════════════════════
-- Migration 055: Metric layout configuration
--
-- Adds JSONB layout columns to store configurable Ecom / Lead Gen dashboard layouts.
-- Each layout defines:
--   kpi_cards      — metric keys shown with sparklines (default 3)
--   top_metrics    — metric keys shown without sparklines below the KPI row (default 4)
--   table_columns  — ordered campaign table column keys
--
-- agency_settings.metric_layouts  — global default for all clients
-- clients.metric_layout_override  — per-client override (null = use agency default)

ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS metric_layouts JSONB DEFAULT NULL;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS metric_layout_override JSONB DEFAULT NULL;

-- ═══════════════════════════════════════════════════════════════
-- 056_client_layout_type.sql
-- ═══════════════════════════════════════════════════════════════
-- Add explicit layout_type to clients
-- NULL = auto-detect from campaign assignments (existing behaviour)
-- 'lead_gen' = always use lead gen layout
-- 'ecom'     = always use ecom layout

ALTER TABLE clients ADD COLUMN IF NOT EXISTS layout_type TEXT DEFAULT NULL;

-- ═══════════════════════════════════════════════════════════════
-- 057_ahrefs_keywords_pages.sql
-- ═══════════════════════════════════════════════════════════════
-- Migration 057: ahrefs_keywords + ahrefs_pages tables
-- Stores per-snapshot keyword rankings and top organic pages for Ahrefs-connected clients.

CREATE TABLE IF NOT EXISTS ahrefs_keywords (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  keyword       TEXT NOT NULL,
  position      INT,
  volume        INT,
  traffic       INT,
  difficulty    INT,
  synced_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(connection_id, date, keyword)
);
CREATE INDEX IF NOT EXISTS idx_ahrefs_keywords_client_date ON ahrefs_keywords(client_id, date);

CREATE TABLE IF NOT EXISTS ahrefs_pages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id    UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  url              TEXT NOT NULL,
  organic_traffic  INT,
  organic_keywords INT,
  synced_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(connection_id, date, url)
);
CREATE INDEX IF NOT EXISTS idx_ahrefs_pages_client_date ON ahrefs_pages(client_id, date);

-- ═══════════════════════════════════════════════════════════════
-- 058_gsc_drop_country_dimension.sql
-- ═══════════════════════════════════════════════════════════════
-- Migration 058: Drop country from GSC unique constraint
--
-- The GSC connector was fetching date × query × page × country (4 dimensions),
-- causing row counts of 1M+ on backfills for medium-traffic sites, leading to
-- Vercel 300s timeouts. Country is stored but never displayed in the UI.
--
-- Fix: aggregate across countries at the API level (drop 'country' from dimensions),
-- and change the unique constraint to (connection_id, date, query, page).

-- Step 1: Remove duplicate per-country rows, keeping the row with the most clicks
-- for each (connection_id, date, query, page) group.
DELETE FROM gsc_metrics a
  USING gsc_metrics b
  WHERE a.connection_id = b.connection_id
    AND a.date          = b.date
    AND a.query         = b.query
    AND a.page          = b.page
    AND a.id            < b.id;

-- Step 2: Drop the old unique index (includes country)
DROP INDEX IF EXISTS idx_gsc_unique_row;

-- Step 3: Make country nullable (we stop writing it going forward)
ALTER TABLE gsc_metrics
  ALTER COLUMN country DROP NOT NULL,
  ALTER COLUMN country SET DEFAULT NULL;

-- Step 4: Create new unique index without country
CREATE UNIQUE INDEX idx_gsc_unique_row
  ON gsc_metrics(connection_id, date, query, page);

-- ═══════════════════════════════════════════════════════════════
-- 059_gsc_summary_rpc.sql
-- ═══════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════
-- 060_google_all_conversions_value.sql
-- ═══════════════════════════════════════════════════════════════
-- Add all_conversions_value to Google Ads metrics tables.
-- This captures all conversion types (primary + secondary), giving more accurate ROAS.
ALTER TABLE google_ads_metrics
  ADD COLUMN IF NOT EXISTS all_conversions_value DECIMAL(14,4);

ALTER TABLE google_ads_ad_metrics
  ADD COLUMN IF NOT EXISTS all_conversions_value DECIMAL(14,4);

-- ═══════════════════════════════════════════════════════════════
-- 061_email_nullable.sql
-- ═══════════════════════════════════════════════════════════════
-- Migration 061: Make clients.email nullable
-- Email was NOT NULL in the initial schema, but the add-client flow only collects name + slug.
ALTER TABLE clients ALTER COLUMN email DROP NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- 062_content_settings_phone.sql
-- ═══════════════════════════════════════════════════════════════
-- Migration 062: Ensure phone_number column exists on content_settings
-- Migration 048 was supposed to add this but may not have been applied.
-- Using IF NOT EXISTS makes this idempotent.
ALTER TABLE content_settings ADD COLUMN IF NOT EXISTS phone_number TEXT;

-- ═══════════════════════════════════════════════════════════════
-- 063_ahrefs_extended_metrics.sql
-- ═══════════════════════════════════════════════════════════════
-- Migration 063: Add traffic_value, paid_keywords, paid_traffic to ahrefs_metrics
-- These fields are available via the Ahrefs API v3 metrics-history endpoint
-- (org_cost → traffic_value, paid_keywords, paid_traffic).
ALTER TABLE ahrefs_metrics ADD COLUMN IF NOT EXISTS traffic_value NUMERIC(14,2);
ALTER TABLE ahrefs_metrics ADD COLUMN IF NOT EXISTS paid_keywords  INTEGER;
ALTER TABLE ahrefs_metrics ADD COLUMN IF NOT EXISTS paid_traffic   INTEGER;

-- ═══════════════════════════════════════════════════════════════
-- 064_content_featured_image.sql
-- ═══════════════════════════════════════════════════════════════
-- Migration 064: Add featured_image_url to content_topics and content_posts
-- Allows admins to attach a featured image during the topic review/approval step,
-- which is then forwarded to WordPress on publish.
ALTER TABLE content_topics ADD COLUMN IF NOT EXISTS featured_image_url TEXT;
ALTER TABLE content_posts  ADD COLUMN IF NOT EXISTS featured_image_url TEXT;

-- ═══════════════════════════════════════════════════════════════
-- 065_content_topic_seo_fields.sql
-- ═══════════════════════════════════════════════════════════════
-- Migration 065: Add SEO brief fields to content_topics
-- Enables SEOContentHero-style topic briefs with keyword research, GSC insights,
-- internal/external link suggestions, and content structure guidance.
ALTER TABLE content_topics
  ADD COLUMN IF NOT EXISTS target_keyword      TEXT,
  ADD COLUMN IF NOT EXISTS gsc_boost_keyword   TEXT,
  ADD COLUMN IF NOT EXISTS search_volume       INTEGER,
  ADD COLUMN IF NOT EXISTS keyword_difficulty  INTEGER,
  ADD COLUMN IF NOT EXISTS suggested_title     TEXT,
  ADD COLUMN IF NOT EXISTS outgoing_links      TEXT[],
  ADD COLUMN IF NOT EXISTS internal_links      TEXT[],
  ADD COLUMN IF NOT EXISTS word_count_target   INTEGER DEFAULT 1500,
  ADD COLUMN IF NOT EXISTS page_to_support     TEXT;

