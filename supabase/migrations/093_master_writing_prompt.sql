-- 093: Add master_writing_prompt column to agency_settings
-- Stores the agency-level blog writing prompt template.
-- Template variables substituted at generate time:
-- [BRAND_NAME], [BRAND_DESCRIPTION], [TARGET_AUDIENCE], [VOICE_NOTES],
-- [WORD_COUNT], [PRIMARY_KEYWORD], [WORKING_TITLE]

ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS master_writing_prompt TEXT;
