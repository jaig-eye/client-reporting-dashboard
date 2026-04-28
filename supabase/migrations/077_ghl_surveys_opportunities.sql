-- Add opportunity and pipeline columns to ghl_metrics.
-- forms_submitted now covers forms + surveys combined.
-- Per-form/survey breakdown is stored in raw_data->form_breakdown JSONB.
ALTER TABLE ghl_metrics
  ADD COLUMN IF NOT EXISTS new_opportunities  INT           NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS won_opportunities  INT           NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lost_opportunities INT           NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS won_value          NUMERIC(12,2) NOT NULL DEFAULT 0;
