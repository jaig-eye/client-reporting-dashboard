-- 036: Conversion action fallback + AI defaults
-- Adds secondary (fallback) conversion action fields for Meta campaigns.
-- When the primary action type isn't found for a campaign/ad/adset,
-- the dashboard falls back to the secondary action type.
-- Also updates AI defaults to OpenAI.

-- Agency-level fallback actions
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS default_lead_action_fallback     TEXT DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS default_purchase_action_fallback TEXT;

-- Client-level fallback overrides (NULL = use agency default)
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS lead_action_fallback     TEXT,
  ADD COLUMN IF NOT EXISTS purchase_action_fallback TEXT;

-- Update agency default primary lead action to the more accurate grouped type
-- Only update if still set to the old default
UPDATE agency_settings
  SET default_lead_action = 'onsite_conversion.lead_grouped'
  WHERE default_lead_action = 'lead' OR default_lead_action IS NULL;

-- Update AI defaults to OpenAI (cheaper for content generation)
UPDATE agency_settings
  SET ai_provider = 'openai',
      ai_model    = 'gpt-4o'
  WHERE ai_provider = 'anthropic' OR ai_provider IS NULL;
