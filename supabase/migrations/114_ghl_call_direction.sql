-- Migration 114: Add incoming_calls and outgoing_calls columns to ghl_metrics
-- existing total_calls = incoming_calls + outgoing_calls
-- missed_calls now means incoming missed calls only (not unread-thread proxy)

ALTER TABLE ghl_metrics
  ADD COLUMN IF NOT EXISTS incoming_calls INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outgoing_calls INT DEFAULT 0;
