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
