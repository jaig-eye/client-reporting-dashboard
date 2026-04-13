-- ─────────────────────────────────────────────────────────────────────────────
-- 047: Per-benchmark visibility + CPL benchmark target
-- ─────────────────────────────────────────────────────────────────────────────

-- Add CPL benchmark target to global agency settings
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS benchmark_cpl NUMERIC DEFAULT 50;

-- Add CPL benchmark override to per-client benchmarks
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS benchmark_cpl NUMERIC;

-- Which benchmarks are shown in the benchmark panel and admin health cards.
-- NULL = not configured (use legacy heuristic: ROAS only for ecom clients).
-- When set, only the listed keys are shown.
-- Valid keys: roas, ctr, cpc, conv_rate, cpm, cpl
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS enabled_benchmarks TEXT[];
