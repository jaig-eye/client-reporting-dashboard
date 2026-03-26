-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 028: Ensure ad-level creative columns exist
--
-- Safe to run multiple times (ADD COLUMN IF NOT EXISTS).
-- Fixes databases that were set up before migration 025 was applied.
-- These columns are required by upsertGoogleAdsAdMetrics in sync.ts.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Google Ads: creative columns added in 025 ────────────────────────────────
ALTER TABLE google_ads_ad_metrics
  ADD COLUMN IF NOT EXISTS headlines     JSONB,
  ADD COLUMN IF NOT EXISTS descriptions  JSONB,
  ADD COLUMN IF NOT EXISTS final_url     TEXT,
  ADD COLUMN IF NOT EXISTS image_url     TEXT,
  ADD COLUMN IF NOT EXISTS ad_strength   TEXT,
  ADD COLUMN IF NOT EXISTS ad_status     TEXT;

-- ── Meta Ads: creative columns added in 025 ──────────────────────────────────
ALTER TABLE meta_ads_ad_metrics
  ADD COLUMN IF NOT EXISTS image_url         TEXT,
  ADD COLUMN IF NOT EXISTS video_id          TEXT,
  ADD COLUMN IF NOT EXISTS video_thumb_url   TEXT,
  ADD COLUMN IF NOT EXISTS creative_body     TEXT,
  ADD COLUMN IF NOT EXISTS creative_title    TEXT,
  ADD COLUMN IF NOT EXISTS creative_link_url TEXT,
  ADD COLUMN IF NOT EXISTS ad_status         TEXT;
