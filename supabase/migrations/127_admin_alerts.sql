-- Migration 127: Unified admin_alerts table for all in-app alert types.
--
-- Consolidates ad_insights, ad_fuel, content, and integration alerts into a single
-- queryable table. Replaces scattered per-system alert tracking.
-- Columns: type, severity, client_id (FK → clients), denormalized client_name,
-- title, body, meta JSONB, link_url, read_at, dismissed_at.

CREATE TABLE admin_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type         TEXT NOT NULL CHECK (type IN ('ad_insights', 'ad_fuel', 'content', 'integration')),
  severity     TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  client_id    UUID REFERENCES clients(id) ON DELETE CASCADE,
  client_name  TEXT,
  title        TEXT NOT NULL,
  body         TEXT,
  meta         JSONB NOT NULL DEFAULT '{}',
  link_url     TEXT,
  read_at      TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_alerts_type    ON admin_alerts(type, created_at DESC);
CREATE INDEX idx_admin_alerts_client  ON admin_alerts(client_id);
CREATE INDEX idx_admin_alerts_unread  ON admin_alerts(read_at) WHERE read_at IS NULL AND dismissed_at IS NULL;
CREATE INDEX idx_admin_alerts_created ON admin_alerts(created_at DESC);
