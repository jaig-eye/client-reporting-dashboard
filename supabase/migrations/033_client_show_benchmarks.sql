-- Add show_benchmarks toggle to clients table.
-- When true, the performance benchmarks section is visible on that client's dashboard.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS show_benchmarks BOOLEAN DEFAULT false;
