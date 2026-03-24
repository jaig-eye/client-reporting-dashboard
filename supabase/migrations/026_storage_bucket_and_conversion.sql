-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 026: Storage bucket + conversion mapping fields
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Create the uploads storage bucket ────────────────────────────────────────
-- This is idempotent — safe to re-run.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'uploads',
  'uploads',
  true,
  4194304,  -- 4 MB
  ARRAY['image/jpeg','image/png','image/gif','image/webp','image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public            = EXCLUDED.public,
  file_size_limit   = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Allow anyone to read public objects (for logo display in client dashboards)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'Public uploads read'
  ) THEN
    CREATE POLICY "Public uploads read"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'uploads');
  END IF;
END $$;

-- Allow service role to insert (our API uses service-role key)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'Service role uploads insert'
  ) THEN
    CREATE POLICY "Service role uploads insert"
      ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'uploads');
  END IF;
END $$;

-- ── Conversion mapping on agency_settings ────────────────────────────────────
-- Global defaults for which Meta action type counts as a lead or purchase.
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS default_lead_action     TEXT DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS default_purchase_action TEXT DEFAULT 'purchase';

-- ── Per-client conversion mapping overrides ───────────────────────────────────
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS lead_action     TEXT,  -- NULL = use agency default
  ADD COLUMN IF NOT EXISTS purchase_action TEXT;  -- NULL = use agency default
