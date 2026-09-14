-- Local-only platform: what a hosted Supabase project provides before any migration runs.
--
-- The migrations were written against Supabase, which ships these roles, schemas and a realtime
-- publication. A plain Postgres has none of them, so they are created here — only as much as the
-- migrations and PostgREST actually touch. Idempotent: safe to run on every migrate.
--
-- Never run this against a real Supabase project. It exists for .local/pgdata only.

-- ── Roles ────────────────────────────────────────────────────────────────────────
-- PostgREST connects as `authenticator` and switches to the role named in the request's JWT.
-- The app's server-side client always uses a service_role key, and service_role bypasses RLS —
-- exactly as it does in production, where most tables have RLS enabled with no policies.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN CREATE ROLE anon          NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN CREATE ROLE service_role  NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD 'authenticator'; END IF;
END $$;

GRANT anon, authenticated, service_role TO authenticator;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Supabase grants on everything created in public; migrations rely on that and never grant
-- table access themselves. Default privileges cover objects the migrations create next.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- ── auth ─────────────────────────────────────────────────────────────────────────
-- Migration 002 writes policies with auth.jwt(). These read the claims PostgREST sets per request,
-- the same way Supabase's own definitions do.
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(auth.jwt() ->> 'sub', '')::uuid $$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT auth.jwt() ->> 'role' $$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- ── storage ──────────────────────────────────────────────────────────────────────
-- Migration 026 inserts the `uploads` bucket and adds policies on storage.objects. Files
-- themselves are served from disk by the local gateway, not from these tables.
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id                 text PRIMARY KEY,
  name               text NOT NULL,
  public             boolean DEFAULT false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id  text REFERENCES storage.buckets (id),
  name       text,
  metadata   jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- ── realtime ─────────────────────────────────────────────────────────────────────
-- Migrations 141 and 142 add tables to this publication. Nothing subscribes to it locally.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

-- ── Migration bookkeeping ────────────────────────────────────────────────────────
-- Outside `public`, so PostgREST never exposes it.
CREATE SCHEMA IF NOT EXISTS local_meta;

CREATE TABLE IF NOT EXISTS local_meta.migrations (
  name       text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
