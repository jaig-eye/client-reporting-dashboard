-- Add custom_slug to content_topics for wizard-generated pages.
-- When set, the generate route uses this as the initial WP slug instead of the AI-suggested one.
ALTER TABLE content_topics ADD COLUMN IF NOT EXISTS custom_slug TEXT;
