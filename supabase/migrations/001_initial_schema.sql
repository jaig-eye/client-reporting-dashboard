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
