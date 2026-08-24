-- Raw error detail alongside the bucketed `cause`, and a broader cause taxonomy so
-- connection resets, TLS failures, and unreachable hosts stop being lumped into 'other'.
ALTER TABLE site_incidents ADD COLUMN IF NOT EXISTS error_detail TEXT;
ALTER TABLE site_checks    ADD COLUMN IF NOT EXISTS error_detail TEXT;

-- 'connect_timeout' (could not open a connection) is tracked separately from 'timeout'
-- (connected but slow) so the two can escalate on different ladders.
ALTER TABLE site_incidents DROP CONSTRAINT IF EXISTS site_incidents_cause_check;
ALTER TABLE site_incidents ADD CONSTRAINT site_incidents_cause_check
  CHECK (cause IN ('timeout','connect_timeout','4xx','5xx','dns','connection_refused','connection_reset','tls','host_unreachable','other'));
