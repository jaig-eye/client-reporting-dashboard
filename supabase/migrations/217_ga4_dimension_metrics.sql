-- ─────────────────────────────────────────────────────────────────────────────
-- 217: GA4 audience and behaviour detail for the client Analytics page
--
-- One row per property, day, report and value:
--   device        desktop / mobile / tablet
--   city          the visitor's city (top 25 per day)
--   landing_page  the first page of a visit (top 25 per day)
--   key_event     events marked as key events (conversions) in GA4, so the page can say
--                 what "conversions" actually counted
--
-- Written best-effort by the GA4 sync (lib/sync.ts upsertGA4DimensionMetrics); read by
-- /dashboard/analytics. A new table only: nothing existing changes, and the sync keeps
-- working if this migration hasn't been applied yet.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ga4_dimension_metrics (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id    UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id)            ON DELETE CASCADE,
  date             DATE NOT NULL,
  dimension        TEXT NOT NULL CHECK (dimension IN ('device', 'city', 'landing_page', 'key_event')),
  value            TEXT NOT NULL,
  sessions         INT  NOT NULL DEFAULT 0,
  users            INT  NOT NULL DEFAULT 0,
  conversions      INT  NOT NULL DEFAULT 0,
  engaged_sessions INT  NOT NULL DEFAULT 0,
  event_count      INT  NOT NULL DEFAULT 0,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, date, dimension, value)
);

CREATE INDEX IF NOT EXISTS idx_ga4_dim_client_date
  ON public.ga4_dimension_metrics (client_id, dimension, date);

-- Same lockdown as every other table here: RLS on with zero policies, so anon and
-- authenticated reach nothing and only the service role (createAdminClient) can read or write.
ALTER TABLE public.ga4_dimension_metrics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ga4_dimension_metrics FROM anon, authenticated;
GRANT ALL ON public.ga4_dimension_metrics TO service_role;

COMMENT ON TABLE public.ga4_dimension_metrics IS
  'GA4 daily detail by device, city, landing page and key event. Written best-effort by the GA4 sync; read by /dashboard/analytics.';
