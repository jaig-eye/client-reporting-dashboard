CREATE TABLE IF NOT EXISTS metric_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  metric       TEXT NOT NULL,
  current_val  NUMERIC,
  prior_val    NUMERIC,
  pct_change   NUMERIC,
  direction    TEXT NOT NULL,
  insight      TEXT,
  dismissed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_metric_alerts_client      ON metric_alerts(client_id);
CREATE INDEX IF NOT EXISTS idx_metric_alerts_dismissed   ON metric_alerts(dismissed_at) WHERE dismissed_at IS NULL;
