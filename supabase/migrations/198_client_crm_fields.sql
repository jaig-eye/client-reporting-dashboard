-- ─────────────────────────────────────────────────────────────────────────────
-- CRM fields on clients: attention temperature + last-contact tracking.
--
-- `temperature` is how much attention the client needs right now, not how happy
-- they are: high = needs hands-on work this week. Nullable = never triaged.
--
-- `last_contacted_at` is jotted down by an admin (there is no automatic call/email
-- capture yet). Logging a note in a contact-type category stamps it as a side
-- effect, so the common path needs no extra click. See 199_note_categories.sql.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS temperature           TEXT,
  ADD COLUMN IF NOT EXISTS last_contacted_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_contact_note_id  UUID,
  ADD COLUMN IF NOT EXISTS contact_stale_days    INT,
  ADD COLUMN IF NOT EXISTS last_contact_alert_at TIMESTAMPTZ;

-- Guarded so re-running the migration is safe (ADD CONSTRAINT has no IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_temperature_check'
  ) THEN
    ALTER TABLE clients
      ADD CONSTRAINT clients_temperature_check
      CHECK (temperature IS NULL OR temperature IN ('low','medium','high'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_contact_stale_days_check'
  ) THEN
    ALTER TABLE clients
      ADD CONSTRAINT clients_contact_stale_days_check
      CHECK (contact_stale_days IS NULL OR (contact_stale_days >= 1 AND contact_stale_days <= 365));
  END IF;
END $$;

COMMENT ON COLUMN clients.temperature IS
  'Attention level: low|medium|high. NULL = not triaged yet.';
COMMENT ON COLUMN clients.contact_stale_days IS
  'Per-client override of agency_settings.contact_stale_days. NULL = use agency default.';
COMMENT ON COLUMN clients.last_contact_alert_at IS
  'Dedup marker so the staleness cron alerts once per stale streak, not every run.';

-- Agency-wide default for the staleness threshold.
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS contact_stale_days INT NOT NULL DEFAULT 14;

-- The staleness cron orders by last_contacted_at with never-contacted clients first.
CREATE INDEX IF NOT EXISTS idx_clients_contact_staleness
  ON clients (last_contacted_at NULLS FIRST);

-- admin_alerts.type needs a CRM value for the staleness alert.
ALTER TABLE admin_alerts DROP CONSTRAINT IF EXISTS admin_alerts_type_check;
ALTER TABLE admin_alerts
  ADD CONSTRAINT admin_alerts_type_check
  CHECK (type IN ('ad_insights','ad_fuel','content','integration','crm'));
