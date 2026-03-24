-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 025: Expanded creative fields for ad-level metrics
--
-- Google Ads: adds headlines, descriptions, final_url, image_url, ad_strength
-- Meta Ads:   adds image_url (high-res), video fields, creative copy fields
--             also adds ad_status for delivery state
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Google Ads ad-level creative ─────────────────────────────────────────────

ALTER TABLE google_ads_ad_metrics
  ADD COLUMN IF NOT EXISTS headlines     JSONB,        -- ["Headline 1", "Headline 2", ...]
  ADD COLUMN IF NOT EXISTS descriptions  JSONB,        -- ["Description 1", ...]
  ADD COLUMN IF NOT EXISTS final_url     TEXT,         -- first entry from final_urls array
  ADD COLUMN IF NOT EXISTS image_url     TEXT,         -- image_ad.image_url for image ads
  ADD COLUMN IF NOT EXISTS ad_strength   TEXT,         -- EXCELLENT | GOOD | AVERAGE | POOR | PENDING | UNSPECIFIED
  ADD COLUMN IF NOT EXISTS ad_status     TEXT;         -- ENABLED | PAUSED | REMOVED

-- ── Meta Ads ad-level creative ────────────────────────────────────────────────

ALTER TABLE meta_ads_ad_metrics
  ADD COLUMN IF NOT EXISTS image_url         TEXT,     -- full-size creative image
  ADD COLUMN IF NOT EXISTS video_id          TEXT,     -- Meta video asset ID
  ADD COLUMN IF NOT EXISTS video_thumb_url   TEXT,     -- video poster/thumbnail
  ADD COLUMN IF NOT EXISTS creative_body     TEXT,     -- primary ad copy text
  ADD COLUMN IF NOT EXISTS creative_title    TEXT,     -- ad headline
  ADD COLUMN IF NOT EXISTS creative_link_url TEXT,     -- destination / link URL
  ADD COLUMN IF NOT EXISTS ad_status         TEXT;     -- ACTIVE | PAUSED | DELETED

-- Update the unique constraint comment (no DDL change needed — existing unique index is fine)