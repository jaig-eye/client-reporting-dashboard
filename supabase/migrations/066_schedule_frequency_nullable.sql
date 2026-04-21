-- Make schedule_frequency nullable (null = manual / no schedule)
-- and widen the CHECK to include monthly preset values added in the form.

ALTER TABLE content_settings
  ALTER COLUMN schedule_frequency DROP NOT NULL;

ALTER TABLE content_settings
  DROP CONSTRAINT IF EXISTS content_settings_schedule_frequency_check;

ALTER TABLE content_settings
  ADD CONSTRAINT content_settings_schedule_frequency_check
  CHECK (
    schedule_frequency IS NULL
    OR schedule_frequency IN (
      'daily', 'weekly', 'biweekly',
      'monthly', 'monthly_first', 'monthly_mid', 'monthly_end'
    )
  );
