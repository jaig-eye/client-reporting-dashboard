-- ─────────────────────────────────────────────────────────────────────────────
-- Atomic per-token guess counter for password-reset codes.
--
-- Migration 197 added password_reset_tokens.attempts as the cross-instance brute-
-- force bound. Charging it from the app with a read-modify-write (read attempts,
-- write attempts+1) is a lost-update race: K concurrent wrong guesses against one
-- live code all read the same value and all write value+1, so the counter advances
-- by 1 instead of K and the code is never burned at the cap — defeating the whole
-- point of a DB-side counter.
--
-- This does the increment atomically in a single UPDATE (`attempts = attempts + 1
-- ... RETURNING`), and burns the token in the same call once the cap is reached, so
-- concurrency cannot get more than `p_max` guesses against an issued code no matter
-- how many IPs or serverless instances the attacker fans across.
--
-- SECURITY DEFINER + service-role-only EXECUTE: it is called exclusively by the
-- server (createAdminClient) from /api/auth/reset-password, never by anon.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.consume_reset_attempt(p_token_id uuid, p_max integer)
RETURNS TABLE (attempts integer, burned boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_attempts integer;
  v_burned   boolean := false;
BEGIN
  -- Atomic increment. Only touches a still-live token; a burned/used one returns nothing.
  UPDATE password_reset_tokens
     SET attempts = attempts + 1
   WHERE id = p_token_id
     AND used_at IS NULL
  RETURNING password_reset_tokens.attempts INTO v_attempts;

  IF v_attempts IS NULL THEN
    -- Already used/burned or gone — nothing to charge.
    RETURN QUERY SELECT NULL::integer, false;
    RETURN;
  END IF;

  -- At or over the cap: burn the code so no further guess can succeed.
  IF v_attempts >= p_max THEN
    UPDATE password_reset_tokens
       SET used_at = now()
     WHERE id = p_token_id
       AND used_at IS NULL;
    v_burned := true;
  END IF;

  RETURN QUERY SELECT v_attempts, v_burned;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_reset_attempt(uuid, integer) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_reset_attempt(uuid, integer) TO service_role;
