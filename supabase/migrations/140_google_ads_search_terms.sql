-- Search terms report for Google Search campaigns.
-- Stores actual user queries that triggered ads (from search_term_view in GAQL),
-- distinct from bidded keywords stored in google_ads_keywords.

CREATE TABLE IF NOT EXISTS google_ads_search_terms (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id    UUID NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id)    ON DELETE CASCADE,
  campaign_id      TEXT NOT NULL,
  campaign_name    TEXT NOT NULL DEFAULT '',
  ad_group_id      TEXT NOT NULL,
  ad_group_name    TEXT NOT NULL DEFAULT '',
  search_term      TEXT NOT NULL,
  match_type       TEXT,
  status           TEXT,
  date             DATE NOT NULL,
  impressions      INTEGER   DEFAULT 0,
  clicks           INTEGER   DEFAULT 0,
  spend            NUMERIC(12,2) DEFAULT 0,
  conversions      NUMERIC(10,4) DEFAULT 0,
  conversion_value NUMERIC(12,2) DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(connection_id, ad_group_id, search_term, date)
);

CREATE INDEX IF NOT EXISTS idx_search_terms_client_date
  ON google_ads_search_terms(client_id, date);

CREATE INDEX IF NOT EXISTS idx_search_terms_campaign
  ON google_ads_search_terms(campaign_id, date);
