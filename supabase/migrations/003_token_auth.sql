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
