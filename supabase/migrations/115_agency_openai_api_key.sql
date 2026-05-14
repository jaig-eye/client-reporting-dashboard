-- Migration 115: Add openai_api_key to agency_settings
-- Used exclusively for DALL-E 3 image generation, separate from the main ai_api_key
-- (which may be Anthropic/Claude). Falls back to OPENAI_API_KEY env var if not set.

ALTER TABLE agency_settings ADD COLUMN IF NOT EXISTS openai_api_key TEXT;
