CREATE TABLE IF NOT EXISTS activity_log (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  user_name     TEXT NOT NULL DEFAULT 'System',
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id   TEXT,
  client_id     UUID REFERENCES clients(id) ON DELETE SET NULL,
  client_name   TEXT,
  meta          JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at    ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_user_id       ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_client_id     ON activity_log(client_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_resource_type ON activity_log(resource_type);
