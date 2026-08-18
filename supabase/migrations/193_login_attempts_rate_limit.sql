-- Durable, cross-instance rate-limit store for admin login attempts.
-- Replaces the per-instance in-memory Map (bypassable on serverless by spreading
-- requests across Lambda instances). The server reads/writes this via service_role.

CREATE TABLE IF NOT EXISTS public.login_attempts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip         text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_created
  ON public.login_attempts (ip, created_at DESC);

-- Same default-deny posture as the rest of the schema: RLS on, no policies, and no
-- grants to anon/authenticated. Only service_role (used by the server) can touch it.
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.login_attempts FROM PUBLIC;
REVOKE ALL ON public.login_attempts FROM anon;
REVOKE ALL ON public.login_attempts FROM authenticated;
