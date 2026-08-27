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
REVOKE ALL ON FUNCTION public.get_gsc_summary(uuid, uuid, date, date, integer)
  FROM anon, authenticated, PUBLIC;

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

-- Pin search_path on the SECURITY DEFINER function so a caller cannot shadow a
-- referenced object with one of their own and have it execute as the owner. This
-- is only exploitable by a role that can create objects, but a definer function
-- with a mutable search_path is a standing hazard regardless.
ALTER FUNCTION public.get_gsc_summary(uuid, uuid, date, date, integer)
  SET search_path = public, pg_temp;

-- Same hardening for the two other flagged functions (both INVOKER, so lower
-- stakes, but the linter is right that an unpinned search_path is a smell).
ALTER FUNCTION public.append_silo_pending_link(uuid, jsonb)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.set_content_posts_updated_at()
  SET search_path = public, pg_temp;
