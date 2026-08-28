-- ─────────────────────────────────────────────────────────────────────────────
-- Close the one hole in an otherwise sound database lockdown.
--
-- THE GOOD NEWS FIRST, because it shapes what this migration does and does not
-- need to do: every table in `public` has RLS ENABLED with ZERO policies, and
-- zero tables have RLS off. For an app that reads exclusively through the
-- service-role key, that is the correct configuration — the service role bypasses
-- RLS, while `anon` and `authenticated` can read nothing at all. The publishable
-- anon key that ships in the browser bundle is therefore not a data-access
-- credential, and no table can be read with it.
--
-- THE HOLE: `get_gsc_summary` is SECURITY DEFINER and EXECUTE is granted to
-- `anon`. SECURITY DEFINER runs as the function owner, which bypasses RLS — so
-- that one function punches straight through the lockdown. Anyone holding the
-- public anon key could POST to /rest/v1/rpc/get_gsc_summary with an arbitrary
-- p_client_id and read that client's Search Console data: queries, pages,
-- impressions, clicks. Unauthenticated, cross-tenant, no audit trail.
--
-- It has NO callers anywhere in src/ (verified by grep), so revoking it cannot
-- break a feature. The dashboards read GSC through the service role.
--
-- The remaining public-executable functions are all SECURITY INVOKER, so they run
-- AS the caller and RLS still blocks their underlying tables — they return empty
-- for anon rather than leaking. They are revoked anyway: an invoker function is
-- only safe for as long as every table it touches keeps RLS on, and that is an
-- invariant nobody is checking on each future migration. Defence in depth costs
-- nothing here because none of them is called with the anon key either.
--
-- WHAT THIS DOES NOT TOUCH: the service role. Every server-side read — admin
-- pages, client magic-link dashboards, crons — goes through createAdminClient(),
-- which uses the service-role key and is unaffected by GRANT/REVOKE on anon and
-- authenticated. The magic-link client dashboards keep working exactly as before.
-- ─────────────────────────────────────────────────────────────────────────────

-- The actual leak. SECURITY DEFINER + anon EXECUTE = RLS bypass for the public.
--
-- Guarded with to_regprocedure so the whole migration does not abort on a database
-- where a named function is absent. These migrations run as one implicit
-- transaction, so a bare statement against a missing function (see the
-- set_content_posts_updated_at case below, which no migration in this repo
-- creates) would roll the ENTIRE migration back — silently un-doing this very
-- revoke on every fresh/staging/CI rebuild. A missing function cannot leak, so
-- skipping it is correct.
DO $$
BEGIN
  IF to_regprocedure('public.get_gsc_summary(uuid, uuid, date, date, integer)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_gsc_summary(uuid, uuid, date, date, integer) FROM anon, authenticated, PUBLIC';
  END IF;
END $$;

-- Defence in depth: these are SECURITY INVOKER and already return nothing to
-- anon, but no caller uses the anon key, so nothing needs the grant.
DO $$
DECLARE fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated, PUBLIC', fn.sig);
  END LOOP;
END $$;

-- Guarantee the SERVICE ROLE can still execute every server-side function after the
-- PUBLIC revoke above. The app calls ALL RPCs through the service-role key
-- (createAdminClient) — spend rollups on both admin AND client magic-link dashboards
-- (sum_meta_spend_by_client, sum_google_spend_by_client, daily_* …), silo linking,
-- GSC summaries. On a standard Supabase project service_role already holds an
-- explicit grant via default privileges, but any function whose only execute path
-- for service_role was the default PUBLIC grant would 42501 after the revoke and
-- silently take spend reporting offline. An explicit grant is independent of PUBLIC
-- and idempotent, so this closes that gap without changing any behaviour.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Pin search_path on the SECURITY DEFINER function so a caller cannot shadow a
-- referenced object with one of their own and have it execute as the owner. This
-- is only exploitable by a role that can create objects, but a definer function
-- with a mutable search_path is a standing hazard regardless.
--
-- Each ALTER is guarded with to_regprocedure. set_content_posts_updated_at() in
-- particular is created out-of-band (no migration in this repo defines it), so an
-- unguarded ALTER FUNCTION — which has no IF EXISTS form — errored on every
-- database provisioned from the migration chain and rolled the whole migration
-- back, taking the get_gsc_summary revoke above with it.
DO $$
BEGIN
  IF to_regprocedure('public.get_gsc_summary(uuid, uuid, date, date, integer)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.get_gsc_summary(uuid, uuid, date, date, integer) SET search_path = public, pg_temp';
  END IF;

  IF to_regprocedure('public.append_silo_pending_link(uuid, jsonb)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.append_silo_pending_link(uuid, jsonb) SET search_path = public, pg_temp';
  END IF;

  IF to_regprocedure('public.set_content_posts_updated_at()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.set_content_posts_updated_at() SET search_path = public, pg_temp';
  END IF;
END $$;
