-- Migration 075: Per-job progress tracking for long backfill syncs.
-- progress_pct: 0-100, updated by the connector after each chunk.
-- progress_note: human-readable label shown in the sync UI (e.g. "Chunk 12/24 · Jan 2025").

ALTER TABLE sync_jobs
  ADD COLUMN IF NOT EXISTS progress_pct  SMALLINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_note TEXT;
