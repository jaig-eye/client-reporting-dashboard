-- Migration 034: Add hidden_metrics array to clients
-- Allows admins to control which metric cards are shown on the client dashboard.
-- Metric IDs: spend, leads, cpl, roas, ctr, conv_rate, cpm, daily_chart, campaigns

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS hidden_metrics TEXT[] DEFAULT '{}';
