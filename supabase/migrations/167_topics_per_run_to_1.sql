-- Hard-code topics_per_run to 1: one topic per calendar slot, no clutter.
-- Existing rows with topics_per_run > 1 are reset so legacy multi-topic slots stop growing.
UPDATE content_settings SET topics_per_run = 1;
ALTER TABLE content_settings ALTER COLUMN topics_per_run SET DEFAULT 1;
