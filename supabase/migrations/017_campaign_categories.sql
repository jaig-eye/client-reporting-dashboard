-- 017_campaign_categories.sql
-- Replaces the old campaign_settings / goal_type system with a clean category model.
-- Campaign categories are defined at the agency level (with agency defaults),
-- and clients can have their campaigns assigned to categories with optional overrides.
--
-- This removes the mixed "campaign assigning + conversion linking" from before
-- and replaces it with a two-level taxonomy: agency categories → client assignments.

-- ─────────────────────────────────────────────
-- CAMPAIGN CATEGORIES: Agency-defined taxonomy
-- ─────────────────────────────────────────────
-- The agency defines categories that make sense for their business
-- (e.g. "Lead Gen", "Ecommerce", "Brand Awareness", "Retargeting").
-- These are reusable across all clients.

CREATE TABLE IF NOT EXISTS campaign_categories (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  name          TEXT          NOT NULL,

  -- Color used in the UI (hex string, e.g. "#3b82f6")
  color         TEXT          NOT NULL DEFAULT '#6b7280',

  description   TEXT,

  -- Controls which metrics are highlighted for this category.
  -- Values: 'lead_gen' | 'ecommerce' | 'awareness' | 'engagement' | 'custom'
  -- Informs the dashboard display logic (ROAS vs CPL vs CPM emphasis).
  display_mode  TEXT          NOT NULL DEFAULT 'custom' CHECK (display_mode IN (
                                'lead_gen', 'ecommerce', 'awareness', 'engagement', 'custom'
                              )),

  -- Default conversion value for campaigns in this category (agency-wide default).
  -- Can be overridden at the client_campaign_assignment level.
  default_conversion_value  DECIMAL(10,2) NOT NULL DEFAULT 0,

  -- Label for the conversion metric (e.g. "Leads", "Purchases", "Phone Calls").
  -- Used on the client dashboard instead of the generic "Conversions".
  conversion_label          TEXT          NOT NULL DEFAULT 'Conversions',

  -- When true, new campaigns auto-assigned to this category via name-matching rules
  is_default    BOOLEAN       NOT NULL DEFAULT FALSE,

  -- Display order in the UI
  sort_order    INTEGER       NOT NULL DEFAULT 0,

  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_categories_default ON campaign_categories(is_default);

CREATE TRIGGER campaign_categories_updated_at
  BEFORE UPDATE ON campaign_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed a default set of categories. Admins can rename, recolor, or add their own.
INSERT INTO campaign_categories (name, color, display_mode, conversion_label, default_conversion_value, sort_order)
VALUES
  ('Lead Generation',  '#3b82f6', 'lead_gen',   'Leads',    0, 1),
  ('Ecommerce',        '#10b981', 'ecommerce',  'Purchases', 0, 2),
  ('Brand Awareness',  '#8b5cf6', 'awareness',  'Views',     0, 3),
  ('Retargeting',      '#f59e0b', 'lead_gen',   'Leads',     0, 4),
  ('Calls',            '#06b6d4', 'lead_gen',   'Calls',     0, 5)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- CLIENT CAMPAIGN ASSIGNMENTS: Per-campaign category at the client level
-- ─────────────────────────────────────────────────────────────────────────
-- Campaigns are discovered during syncs and auto-inserted here.
-- Admins then assign categories and optionally override conversion logic.

CREATE TABLE IF NOT EXISTS client_campaign_assignments (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                 UUID          NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- The data source this campaign comes from (matches connector type)
  source                    TEXT          NOT NULL CHECK (source IN (
                                            'google_ads', 'meta_ads',
                                            'google_analytics', 'google_search_console'
                                          )),

  -- Platform-native campaign identifier
  campaign_id               TEXT          NOT NULL,
  campaign_name             TEXT          NOT NULL DEFAULT '',

  -- Assigned category (NULL = unassigned / uncategorised)
  category_id               UUID          REFERENCES campaign_categories(id) ON DELETE SET NULL,

  -- Conversion value override for this specific client + campaign.
  -- If NULL, falls back to: category default → agency default → 0.
  conversion_value_override DECIMAL(10,2),

  -- For Meta: which action_type to count as the primary conversion.
  -- NULL = use the category/client default.
  meta_conversion_action    TEXT,

  -- When true, this campaign is excluded from the client dashboard entirely
  hidden                    BOOLEAN       NOT NULL DEFAULT FALSE,

  -- Custom notes or labels for this campaign (visible in admin only)
  notes                     TEXT,

  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE(client_id, source, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_assignments_client ON client_campaign_assignments(client_id);
CREATE INDEX IF NOT EXISTS idx_campaign_assignments_category ON client_campaign_assignments(category_id);

CREATE TRIGGER client_campaign_assignments_updated_at
  BEFORE UPDATE ON client_campaign_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- CONVERSION DEFAULTS: Consistent conversion value configuration
-- ─────────────────────────────────────────────────────────────────────────
-- Stores the default conversion value used when no campaign-level override exists.
-- Follows a hierarchy: campaign override → client default → agency default.
-- Agency default lives in agency_settings; client defaults stored here.

-- Add client-level conversion value default to clients table
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS default_conversion_value DECIMAL(10,2) DEFAULT NULL;

-- Add agency-level conversion value default to agency_settings
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS default_conversion_value DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Add cron_enabled flag (was missing from the agency_settings table)
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS cron_enabled BOOLEAN NOT NULL DEFAULT TRUE;
