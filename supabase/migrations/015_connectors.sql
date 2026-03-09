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
