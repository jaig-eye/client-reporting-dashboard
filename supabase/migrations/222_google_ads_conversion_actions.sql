-- ─────────────────────────────────────────────────────────────────────────────
-- 222: Google Ads conversions, broken down by the action that produced them
--
-- google_ads_metrics.conversions is one number per campaign-day: 117.48 for a month. Nobody can
-- reconcile that against a count of CRM leads, because it does not say what it is made of — how
-- many were calls from the ad, how many were form submissions, how many were something the client
-- would not call a lead at all.
--
-- Google will tell us, segmented by conversion action. With this table the dashboard can put the
-- two side by side honestly: "Google counted 117 — 75 calls from ads, 28 form submissions, 14
-- quote requests" against "your CRM recorded 102 people".
--
-- Two things this table does NOT let us claim:
--   · that the totals should match. Conversions count actions, people count once; one person
--     submitting two forms is two conversions and one lead.
--   · that a conversion is a whole number. With data-driven attribution Google splits credit
--     fractionally across campaigns — 2.5 and 4.9971 are real values from a live account — so the
--     column is numeric, not an integer, and a sum of them will not land on a whole number.
--
-- Written best-effort by the Google Ads sync; a plan without conversion-action reporting simply
-- writes nothing and the breakdown stays hidden.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.google_ads_conversion_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES clients(id)            ON DELETE CASCADE,
  campaign_id     TEXT NOT NULL,
  campaign_name   TEXT,
  date            DATE NOT NULL,
  /** Google's own name for the action, as the account has it configured. */
  action_name     TEXT NOT NULL,
  /** Google's category: PHONE_CALL_LEAD, SUBMIT_LEAD_FORM, PAGE_VIEW, DEFAULT … */
  action_category TEXT,
  /** Fractional under data-driven attribution. Never round this to report it. */
  conversions     NUMERIC NOT NULL DEFAULT 0,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, campaign_id, date, action_name)
);

-- The dashboard reads one client's actions over a date range.
CREATE INDEX IF NOT EXISTS idx_gads_conv_actions_client_date
  ON public.google_ads_conversion_actions (client_id, date DESC);

-- Same lockdown as every other table here: RLS on with zero policies, so anon and
-- authenticated reach nothing and only the service role (createAdminClient) can read or write.
ALTER TABLE public.google_ads_conversion_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_ads_conversion_actions FROM anon, authenticated;
GRANT ALL ON public.google_ads_conversion_actions TO service_role;

COMMENT ON TABLE public.google_ads_conversion_actions IS
  'Google Ads conversions split by conversion action, so a campaign total can be reconciled against CRM leads. Conversions are fractional under data-driven attribution.';
