-- Allow agencies to whitelabel the CRM integration name (default: 'CRM').
-- Replaces all client-visible "GoHighLevel" references.
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS crm_name TEXT NOT NULL DEFAULT 'CRM';
