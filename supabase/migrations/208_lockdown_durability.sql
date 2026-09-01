-- ─────────────────────────────────────────────────────────────────────────────
-- Make migration 196's lockdown durable, and repair what the branch merge undid.
--
-- 196 revoked anon/authenticated EXECUTE on every function in `public` (closing the
-- get_gsc_summary SECURITY DEFINER leak) and pinned search_path on the definer
-- functions. Merging the CRM branch in sequenced three migrations AFTER it, which
-- broke two of its assumptions:
--
--   1. 196's comment states that set_content_posts_updated_at() "is created
--      out-of-band (no migration in this repo defines it)". That is no longer true:
--      200_content_post_republish.sql and 206_updated_at_content_only.sql both
--      define it. So the search_path pin never survives, in EITHER direction:
--        • fresh/CI/staging rebuild — order is 196 → 200 → 206, so to_regprocedure
--          is NULL when 196 runs, the guarded ALTER is correctly skipped, and 200
--          and 206 then create the function with no SET clause;
--        • production, where 196 is applied after 206 already ran — the ALTER lands,
--          but any later CREATE OR REPLACE of that function silently drops it again.
--          CREATE OR REPLACE preserves ownership and ACLs but RESETS SET clauses,
--          volatility and security attributes whenever they are not respecified.
--
--   2. 196's REVOKE is a one-shot sweep over the functions that existed at the
--      moment it ran. Supabase ships pg_default_acl entries that grant anon and
--      authenticated EXECUTE on every function subsequently created in `public`, so
--      each new migration silently reopens the hole. 207 had to hand-write its own
--      REVOKE, which shows the property was understood but never enforced — and
--      relies on every future migration remembering to repeat it.
--
-- This migration fixes the class rather than the instances: it sets DEFAULT
-- PRIVILEGES so newly created functions are locked down automatically, re-runs the
-- sweep to catch everything added since 196 (200, 206, 207), re-asserts the
-- service_role grant, and re-pins search_path now that the trigger function
-- definitively exists.
--
-- SAFE FOR THE CLIENT MAGIC-LINK DASHBOARDS. Every server-side read — admin pages,
-- /dashboard client pages, crons — goes through createAdminClient() on the
-- service-role key, which bypasses RLS and is re-granted EXECUTE below. GRANT and
-- REVOKE on anon/authenticated cannot affect it. Nothing in src/ calls an RPC with
-- the anon key.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Default privileges: every function created in `public` FROM NOW ON is created
--    without anon/authenticated EXECUTE, so the lockdown no longer depends on each
--    future migration remembering to revoke.
--
--    This binds to the role that runs migrations (the current role — postgres on
--    Supabase). A function created by a different role would not inherit it, which
--    is why the sweep in step 2 is kept as well rather than replaced.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM authenticated;

-- Keep service_role executing everything created later, without an explicit grant
-- in each migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;

-- 2. Re-run 196's sweep. Idempotent, and now covers every function added after it
--    (append_silo_pending_link revisions, set_content_posts_updated_at from 200/206,
--    consume_reset_attempt from 207).
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

-- 3. Re-assert the service_role grant over the CURRENT set of functions. Independent
--    of the PUBLIC grant that step 2 removes, so spend rollups
--    (sum_meta_spend_by_client, sum_google_spend_by_client, daily_*) that both the
--    admin and the client magic-link dashboards depend on cannot 42501.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- 4. Re-pin search_path on the SECURITY DEFINER / trigger functions, now that they
--    are guaranteed to exist at this point in the chain. Still guarded with
--    to_regprocedure: these migrations run as one implicit transaction, and
--    ALTER FUNCTION has no IF EXISTS form, so an unguarded statement against a
--    missing function would abort the file and roll back steps 1-3 with it.
DO $$
BEGIN
  IF to_regprocedure('public.set_content_posts_updated_at()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.set_content_posts_updated_at() SET search_path = public, pg_temp';
  END IF;

  IF to_regprocedure('public.get_gsc_summary(uuid, uuid, date, date, integer)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.get_gsc_summary(uuid, uuid, date, date, integer) SET search_path = public, pg_temp';
  END IF;

  IF to_regprocedure('public.append_silo_pending_link(uuid, jsonb)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.append_silo_pending_link(uuid, jsonb) SET search_path = public, pg_temp';
  END IF;
END $$;

-- 5. Verification. Leaves a NOTICE in the migration output naming anything still
--    executable by anon/authenticated, so a future regression is visible at apply
--    time instead of being discovered in an audit.
DO $$
DECLARE leftover TEXT;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ')
    INTO leftover
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));

  IF leftover IS NULL THEN
    RAISE NOTICE '[208] public schema locked down: no function is executable by anon or authenticated.';
  ELSE
    RAISE WARNING '[208] STILL EXECUTABLE by anon/authenticated: %', leftover;
  END IF;
END $$;
