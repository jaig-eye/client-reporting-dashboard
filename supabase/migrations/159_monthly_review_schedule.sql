ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS monthly_review_schedule TEXT NOT NULL DEFAULT 'first_monday';
