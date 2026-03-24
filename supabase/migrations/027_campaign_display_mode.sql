-- 027_campaign_display_mode.sql
--
-- Add display_mode and conversion_label directly to client_campaign_assignments,
-- replacing the indirect category → display_mode relationship.
-- Admins now toggle Ecom / Lead Gen per campaign in the client settings page.
-- The campaign_categories table is left intact for backward compat but
-- is no longer used for display logic.

ALTER TABLE client_campaign_assignments
  ADD COLUMN IF NOT EXISTS display_mode TEXT NOT NULL DEFAULT 'lead_gen';

ALTER TABLE client_campaign_assignments
  ADD COLUMN IF NOT EXISTS conversion_label TEXT;

-- Migrate any existing category-based display_mode to the new column
UPDATE client_campaign_assignments cca
SET
  display_mode     = COALESCE(cc.display_mode, 'lead_gen'),
  conversion_label = cc.conversion_label
FROM campaign_categories cc
WHERE cca.category_id = cc.id
  AND cca.category_id IS NOT NULL;

-- Index for fast lookup by client + source
CREATE INDEX IF NOT EXISTS idx_cca_client_source
  ON client_campaign_assignments (client_id, source);
