-- ─────────────────────────────────────────────────────────────────────────────
-- 220: Google Ads calls, one row per call
--
-- Migration 218 stores these as daily totals, which answers "how many calls did the ads bring in"
-- but not "which of our leads was that". A call placed from an ad routes through Google's own
-- forwarding number, so the number the business sees says nothing about the ad — but both systems
-- record the same event. Google logs the start and duration; the CRM logs an inbound call against
-- a contact. A call starting at 14:32:07 and running 143 seconds is the same call in both.
--
-- Keeping the per-call rows lets the CRM sync match them (lib/adCallMatch.ts) and credit the
-- contact to the ad. It also settles a question the daily totals cannot: when the same number is
-- used on both the Business Profile and an ad's call extension, which of those calls were which.
--
--   started_at        when Google says the call began, as Google reports it. The ad account's
--                     timezone is not stored — the matcher works the offset out from the data
--                     rather than trusting a configured value that may be wrong.
--   duration_seconds  how long it lasted
--   call_status       RECEIVED or MISSED
--   from_ad           placed from the ad itself, rather than a forwarding number on the website
--
-- No caller details: not the number, not the area code, not the country. Those are available from
-- Google and deliberately not selected.
--
-- Written best-effort by the Google Ads sync, which deletes the range before inserting, so there
-- is no unique key to collide on. A new table only; the Ads sync keeps working before it exists.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.google_ads_calls (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id    UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id)            ON DELETE CASCADE,
  started_at       TIMESTAMPTZ NOT NULL,
  duration_seconds INT  NOT NULL DEFAULT 0,
  call_status      TEXT,
  from_ad          BOOLEAN NOT NULL DEFAULT false,
  campaign_id      TEXT,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The CRM sync reads a client's calls for one date range at a time.
CREATE INDEX IF NOT EXISTS idx_google_ads_calls_client_started
  ON public.google_ads_calls (client_id, started_at);

-- Same lockdown as every other table here: RLS on with zero policies, so anon and
-- authenticated reach nothing and only the service role (createAdminClient) can read or write.
ALTER TABLE public.google_ads_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_ads_calls FROM anon, authenticated;
GRANT ALL ON public.google_ads_calls TO service_role;

COMMENT ON TABLE public.google_ads_calls IS
  'One row per Google Ads call: start, duration, status. No caller details. Used to match ad calls to CRM contacts by time.';
