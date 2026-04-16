-- Add explicit layout_type to clients
-- NULL = auto-detect from campaign assignments (existing behaviour)
-- 'lead_gen' = always use lead gen layout
-- 'ecom'     = always use ecom layout

ALTER TABLE clients ADD COLUMN IF NOT EXISTS layout_type TEXT DEFAULT NULL;
