-- Security: get_gsc_summary is SECURITY DEFINER (runs as owner, bypasses RLS).
-- Postgres grants EXECUTE to PUBLIC by default on CREATE FUNCTION, and migrations
-- 059/111/113/120 only added authenticated/service_role grants — never revoking the
-- implicit PUBLIC grant. That let the anon/publishable key invoke the RPC via
-- /rest/v1/rpc/get_gsc_summary and read GSC aggregates (gated only by knowing two
-- random UUIDs). The server calls it via service_role, so revoking PUBLIC/anon/
-- authenticated does not affect the app.

REVOKE EXECUTE ON FUNCTION public.get_gsc_summary(uuid, uuid, date, date, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_gsc_summary(uuid, uuid, date, date, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_gsc_summary(uuid, uuid, date, date, integer) FROM authenticated;
