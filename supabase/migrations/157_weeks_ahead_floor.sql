-- Ensure all clients have at least 6 weeks of lead time for the monthly review workflow
UPDATE content_settings
SET weeks_ahead = 6
WHERE weeks_ahead < 6 AND auto_generate = true;

COMMENT ON COLUMN content_settings.weeks_ahead IS
  'Minimum 6 required for monthly review workflow: topics must generate 5+ weeks ahead';
