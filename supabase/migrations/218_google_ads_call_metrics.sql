-- ─────────────────────────────────────────────────────────────────────────────
-- 218: Calls from Google Ads, per campaign per day
--
-- Someone who taps an ad's call button never visits the website, so the CRM can't tie the call
-- to the ad. Google Ads can, and this stores its counts:
--   phone_calls      metrics.phone_calls: calls from call assets and call ads
--   calls_received   call_view rows with status RECEIVED   (call reporting must be on)
--   calls_missed     call_view rows with status MISSED
--   call_seconds     total duration of those calls
--   calls_from_ad    call_view rows placed from the ad itself
--   calls_from_site  call_view rows placed from Google's forwarding number on the website
--
-- No caller details are stored: not the area code, country or number.
-- Written best-effort by the Google Ads sync (lib/sync.ts upsertGoogleAdsCallMetrics); read by the
-- Overview and CRM pages. A new table only; the Ads sync keeps working before this is applied.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.google_ads_call_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES clients(id)            ON DELETE CASCADE,
  date            DATE NOT NULL,
  campaign_id     TEXT NOT NULL,
  campaign_name   TEXT,
  phone_calls     INT  NOT NULL DEFAULT 0,
  calls_received  INT  NOT NULL DEFAULT 0,
  calls_missed    INT  NOT NULL DEFAULT 0,
  call_seconds    INT  NOT NULL DEFAULT 0,
  calls_from_ad   INT  NOT NULL DEFAULT 0,
  calls_from_site INT  NOT NULL DEFAULT 0,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, date, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_gads_calls_client_date
  ON public.google_ads_call_metrics (client_id, date);

-- Same lockdown as every other table here: RLS on with zero policies, so anon and
-- authenticated reach nothing and only the service role (createAdminClient) can read or write.
ALTER TABLE public.google_ads_call_metrics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_ads_call_metrics FROM anon, authenticated;
GRANT ALL ON public.google_ads_call_metrics TO service_role;

COMMENT ON TABLE public.google_ads_call_metrics IS
  'Daily calls from Google Ads per campaign (phone_calls metric plus call_view status/duration). No caller details. Written best-effort by the Google Ads sync.';
