-- Efficient full-table date-range delete for weekly pruning of gsc_metrics.
-- The existing idx_gsc_client_date covers (client_id, date DESC) — not useful
-- for a WHERE date < cutoff delete across all clients. This covers that query.
CREATE INDEX IF NOT EXISTS idx_gsc_metrics_date_only ON gsc_metrics(date);
