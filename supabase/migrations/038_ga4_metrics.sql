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
