-- ─────────────────────────────────────────────────────────────────────────────
-- Per-code guess cap for the SUPER ADMIN login OTP.
--
-- The sibling password-reset flow got exactly this control in migrations 197 and
-- 207, on the reasoning that an uncapped 6-digit code is not an acceptable second
-- factor. The higher-privilege account was left without it: a wrong OTP guess in
-- /api/auth/admin-login neither incremented a counter nor burned the code, so a
-- code stayed live for its full 10 minutes no matter how many guesses it took.
--
-- The only bound was accountLimiter, keyed `${ip}:` — pure IP, so rotating source
-- address buys a fresh budget. Against a ~900k space that is a real attack for
-- anyone holding a leaked ADMIN_PASSWORD, and the super admin has unlimited
-- privilege, no users row, and no session-revocation path.
--
-- Same shape as 207: atomic `attempts = attempts + 1 ... RETURNING` so K concurrent
-- guesses advance the counter by K rather than 1, and the code is burned in the same
-- statement once the cap is reached.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS super_admin_otp_attempts integer NOT NULL DEFAULT 0;

-- Output columns are named result_*, and every table reference is qualified through
-- the alias `t`. Naming an OUT column `attempts` the same as the table column makes
-- `SET attempts = attempts + 1` ambiguous, and stock Postgres runs
-- plpgsql.variable_conflict = error, so the function would throw on first call.
-- DROP first for the same reason 207 does: OUT parameters cannot be renamed through
-- CREATE OR REPLACE.
DROP FUNCTION IF EXISTS public.consume_super_admin_otp_attempt(integer);

CREATE OR REPLACE FUNCTION public.consume_super_admin_otp_attempt(p_max integer)
RETURNS TABLE (result_attempts integer, result_burned boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_attempts integer;
  v_burned   boolean := false;
BEGIN
  -- Only charge a still-live code. agency_settings is a singleton, but the
  -- super_admin_otp_hash IS NOT NULL predicate is what makes this idempotent
  -- against an already-burned code rather than counting forever.
  UPDATE agency_settings AS t
     SET super_admin_otp_attempts = t.super_admin_otp_attempts + 1
   WHERE t.super_admin_otp_hash IS NOT NULL
  RETURNING t.super_admin_otp_attempts INTO v_attempts;

  IF v_attempts IS NULL THEN
    RETURN QUERY SELECT NULL::integer, false;
    RETURN;
  END IF;

  IF v_attempts >= p_max THEN
    UPDATE agency_settings AS t
       SET super_admin_otp_hash       = NULL,
           super_admin_otp_expires_at = NULL,
           super_admin_otp_attempts   = 0
     WHERE t.super_admin_otp_hash IS NOT NULL;
    v_burned := true;
  END IF;

  RETURN QUERY SELECT v_attempts, v_burned;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_super_admin_otp_attempt(integer) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_super_admin_otp_attempt(integer) TO service_role;
