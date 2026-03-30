-- Migration 031: Google Ads negative keywords (campaign-level + ad-group-level)
-- Not date-segmented — represents the current active negative keyword set.
-- Re-synced on every sync run (non-dated snapshot, upsert on conflict).

CREATE TABLE IF NOT EXISTS google_ads_negative_keywords (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id  UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id      UUID NOT NULL REFERENCES clients(id)           ON DELETE CASCADE,
  campaign_id    TEXT NOT NULL,
  campaign_name  TEXT,
  ad_group_id    TEXT,         -- NULL for campaign-level negatives
  ad_group_name  TEXT,
  keyword_id     TEXT NOT NULL,
  keyword_text   TEXT NOT NULL,
  match_type     TEXT,         -- BROAD | PHRASE | EXACT
  level          TEXT NOT NULL DEFAULT 'campaign',  -- 'campaign' | 'adgroup'
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (connection_id, keyword_id, level)
);

CREATE INDEX IF NOT EXISTS idx_gads_neg_kw_client_campaign
  ON google_ads_negative_keywords(client_id, campaign_id);

CREATE INDEX IF NOT EXISTS idx_gads_neg_kw_adgroup
  ON google_ads_negative_keywords(client_id, campaign_id, ad_group_id)
  WHERE ad_group_id IS NOT NULL;
