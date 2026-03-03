-- 008_client_benchmarks.sql
-- Per-client benchmark overrides.
-- NULL = inherit from agency_settings (global default).

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS benchmark_roas        DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS benchmark_ctr         DECIMAL(8, 6),
  ADD COLUMN IF NOT EXISTS benchmark_cpc         DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS benchmark_conv_rate   DECIMAL(8, 6),
  ADD COLUMN IF NOT EXISTS benchmark_cpm         DECIMAL(10, 2);
