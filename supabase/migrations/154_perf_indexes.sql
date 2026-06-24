-- Campaign drilldown queries filter by (client_id, date) — index covers this range scan
CREATE INDEX IF NOT EXISTS idx_google_ads_ad_metrics_client_date
  ON google_ads_ad_metrics(client_id, date DESC);

-- ghl_metrics only has idx_ghl_metrics_client (no date column) — range queries do full client scan
CREATE INDEX IF NOT EXISTS idx_ghl_metrics_client_date
  ON ghl_metrics(client_id, date DESC);

-- content_topics cron queries by client_id + status + content_type — combined index eliminates double scan
CREATE INDEX IF NOT EXISTS idx_content_topics_client_status_type
  ON content_topics(client_id, status, content_type);
