-- ─────────────────────────────────────────────────────────────────────────────
-- 191: DataForSEO usage ledger (spend tracking)
--
-- Records the cost of each billable DataForSEO operation we make, so the agency can
-- see actual spend inside the dashboard. Cost is the REAL per-request cost DataForSEO
-- returns in its response `cost` field (falling back to a per-operation estimate only
-- when the field is absent). Rows are aggregated (one per client per operation per
-- cron run) to keep the ledger small. Dormant until DataForSEO is connected.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dataforseo_usage (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES clients(id) ON DELETE SET NULL,   -- null = agency-level / unattributed
  operation   TEXT NOT NULL,        -- rank_check | serp_research | keyword_overview | keyword_ideas | search_volume
  units       INT  NOT NULL DEFAULT 1,   -- number of API requests this row aggregates
  cost        NUMERIC(12,6) NOT NULL DEFAULT 0,   -- USD
  date        DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dfs_usage_date       ON dataforseo_usage(date);
CREATE INDEX IF NOT EXISTS idx_dfs_usage_client_date ON dataforseo_usage(client_id, date);
CREATE INDEX IF NOT EXISTS idx_dfs_usage_operation  ON dataforseo_usage(operation, date);
