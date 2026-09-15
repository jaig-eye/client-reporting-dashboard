-- Per-client switch for the rebuilt client dashboard.
--
-- The rebuilt structure gives each channel its own page — Overview (paid ads only), SEO, Analytics,
-- CRM — instead of one Summary page that mixes them. It is being trialled on local SEO clients
-- first, so it is opt-in per client rather than a release for everyone: ecommerce clients keep the
-- current Summary until the new Overview earns its place for them too.
--
-- Default false: every existing client keeps exactly what they have today.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS dashboard_v2 boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.clients.dashboard_v2 IS
  'Opt-in: show the rebuilt per-channel dashboard (Overview / SEO / Analytics / CRM) instead of the combined Summary page.';
