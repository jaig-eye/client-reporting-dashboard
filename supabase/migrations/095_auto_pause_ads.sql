-- Auto-pause ads when Ad Fuel balance goes negative

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS auto_pause_ads      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_resume_ads     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS campaigns_paused_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS ad_pause_log (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                  UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  action                     TEXT        NOT NULL, -- 'paused' | 'resumed' | 'pause_failed' | 'resume_failed'
  trigger                    TEXT        NOT NULL DEFAULT 'auto', -- 'auto' | 'manual'
  balance                    NUMERIC,
  google_campaigns_affected  INTEGER     NOT NULL DEFAULT 0,
  meta_campaigns_affected    INTEGER     NOT NULL DEFAULT 0,
  paused_campaign_ids        JSONB,      -- { google: [...resourceNames], meta: [...campaignIds] }
  error                      TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_pause_log_client    ON ad_pause_log(client_id);
CREATE INDEX IF NOT EXISTS idx_ad_pause_log_created   ON ad_pause_log(created_at DESC);
