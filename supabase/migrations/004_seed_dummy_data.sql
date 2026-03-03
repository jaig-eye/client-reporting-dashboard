-- 004_seed_dummy_data.sql
-- Demo client "Acme Digital Co" with 90 days of realistic Google + Meta PPC data.
-- All inserts are idempotent (ON CONFLICT DO NOTHING).
--
-- Dashboard access URL:
--   /api/auth/access?token=44444444-4444-4444-4444-444444444444
--
-- DO NOT run this in a production environment with real client data.

-- ─── Ensure 003_token_auth columns/indexes exist (idempotent) ─────────────────
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS dashboard_token UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_dashboard_token
  ON clients(dashboard_token);

ALTER TABLE clients DISABLE ROW LEVEL SECURITY;
ALTER TABLE ad_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_metrics DISABLE ROW LEVEL SECURITY;
ALTER TABLE sync_logs DISABLE ROW LEVEL SECURITY;

-- ─── Client ────────────────────────────────────────────────────────────────────
INSERT INTO clients (id, name, email, slug, dashboard_token, created_at, updated_at)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Acme Digital Co',
  'demo@acmedemo.com',
  'acme-digital',
  '44444444-4444-4444-4444-444444444444',
  NOW() - INTERVAL '95 days',
  NOW()
) ON CONFLICT DO NOTHING;

-- ─── Ad Accounts ───────────────────────────────────────────────────────────────
INSERT INTO ad_accounts (id, client_id, platform, account_id, account_name, created_at)
VALUES
  (
    '22222222-2222-2222-2222-222222222222',
    '11111111-1111-1111-1111-111111111111',
    'google', '123-456-7890', 'Acme Google Ads',
    NOW() - INTERVAL '95 days'
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    '11111111-1111-1111-1111-111111111111',
    'meta', 'act_987654321', 'Acme Meta Ads',
    NOW() - INTERVAL '95 days'
  )
ON CONFLICT DO NOTHING;

-- ─── Campaign Metrics (90 days × 5 campaigns = 450 rows) ───────────────────────
--
-- Campaigns and their base daily values:
--   Google | Brand - Search              $35/day  CTR 12%  CPC $1.80  CVR 8%   AOV $55   ROAS ~8.9x
--   Google | Non-Brand - Search         $110/day  CTR 4.5% CPC $3.50  CVR 4%   AOV $95   ROAS ~3.5x
--   Google | Performance Max             $85/day  CTR 3.5% CPC $2.80  CVR 4.5% AOV $95   ROAS ~4.5x
--   Meta   | Retargeting - Website        $55/day  CTR 2.5% CPC $1.50  CVR 6%   AOV $85   ROAS ~5.5x
--   Meta   | Prospecting - Lookalike 1%  $130/day  CTR 1.2% CPC $2.00  CVR 2.5% AOV $90   ROAS ~1.7x
--
-- Daily variation: day-of-week factor × gentle upward trend (+13% over 90d) × oscillating noise

WITH campaign_defs (
  ad_account_id, platform, campaign_id, campaign_name,
  base_spend, base_ctr, base_cpc, base_conv_rate, avg_order_value
) AS (
  VALUES
    ('22222222-2222-2222-2222-222222222222'::UUID, 'google'::TEXT,
     'g_brand_001',    'Brand - Search',
     35.0::NUMERIC,  0.120::NUMERIC, 1.80::NUMERIC, 0.080::NUMERIC, 55.0::NUMERIC),

    ('22222222-2222-2222-2222-222222222222'::UUID, 'google'::TEXT,
     'g_nonbrand_001', 'Non-Brand - Search',
     110.0::NUMERIC, 0.045::NUMERIC, 3.50::NUMERIC, 0.040::NUMERIC, 95.0::NUMERIC),

    ('22222222-2222-2222-2222-222222222222'::UUID, 'google'::TEXT,
     'g_pmax_001',    'Performance Max',
     85.0::NUMERIC,  0.035::NUMERIC, 2.80::NUMERIC, 0.045::NUMERIC, 95.0::NUMERIC),

    ('33333333-3333-3333-3333-333333333333'::UUID, 'meta'::TEXT,
     'm_retarg_001',  'Retargeting - Website Visitors',
     55.0::NUMERIC,  0.025::NUMERIC, 1.50::NUMERIC, 0.060::NUMERIC, 85.0::NUMERIC),

    ('33333333-3333-3333-3333-333333333333'::UUID, 'meta'::TEXT,
     'm_prosp_001',   'Prospecting - Lookalike 1%',
     130.0::NUMERIC, 0.012::NUMERIC, 2.00::NUMERIC, 0.025::NUMERIC, 90.0::NUMERIC)
),

date_series (date, dow_factor, trend_factor, noise_factor) AS (
  SELECT
    d::DATE,
    -- Day-of-week multiplier
    CASE EXTRACT(DOW FROM d)::INT
      WHEN 0 THEN 0.55   -- Sun
      WHEN 1 THEN 0.95   -- Mon
      WHEN 2 THEN 1.02   -- Tue
      WHEN 3 THEN 1.08   -- Wed
      WHEN 4 THEN 1.12   -- Thu
      WHEN 5 THEN 1.15   -- Fri
      WHEN 6 THEN 0.68   -- Sat
    END::NUMERIC,
    -- Gentle upward trend: +13% from day 0 to day 89
    (1.0 + 0.00144 * (d::DATE - (CURRENT_DATE - 89)::DATE))::NUMERIC,
    -- Oscillating noise between 0.88 and 1.12
    (0.88 + 0.24 * (
      (SIN(EXTRACT(EPOCH FROM d::TIMESTAMPTZ) / 86400.0 * 1.3 + 2.5) + 1.0) / 2.0
    ))::NUMERIC
  FROM generate_series(
    CURRENT_DATE - INTERVAL '89 days',
    CURRENT_DATE,
    INTERVAL '1 day'
  ) AS d
),

-- Step 1: compute adjusted spend
with_spend AS (
  SELECT
    c.ad_account_id,
    c.platform,
    c.campaign_id,
    c.campaign_name,
    c.base_ctr,
    c.base_cpc,
    c.base_conv_rate,
    c.avg_order_value,
    ds.date,
    ROUND(c.base_spend * ds.dow_factor * ds.trend_factor * ds.noise_factor, 2) AS spend
  FROM campaign_defs c
  CROSS JOIN date_series ds
),

-- Step 2: derive clicks from CPC
with_clicks AS (
  SELECT *,
    GREATEST(1, ROUND(spend / base_cpc)::BIGINT) AS clicks
  FROM with_spend
),

-- Step 3: derive impressions, conversions, conversion value
with_all AS (
  SELECT *,
    GREATEST(clicks, ROUND(clicks::NUMERIC / base_ctr)::BIGINT)  AS impressions,
    ROUND((clicks::NUMERIC * base_conv_rate), 1)                  AS conversions,
    ROUND((clicks::NUMERIC * base_conv_rate * avg_order_value), 2) AS conversion_value
  FROM with_clicks
)

INSERT INTO campaign_metrics (
  client_id, ad_account_id, platform, campaign_id, campaign_name, date,
  spend, impressions, clicks, conversions, conversion_value,
  roas, ctr, cpc, cpm
)
SELECT
  '11111111-1111-1111-1111-111111111111'::UUID AS client_id,
  ad_account_id,
  platform,
  campaign_id,
  campaign_name,
  date,
  spend,
  impressions,
  clicks,
  conversions,
  conversion_value,
  CASE WHEN spend > 0     THEN ROUND(conversion_value / spend, 4)              ELSE 0 END AS roas,
  CASE WHEN impressions > 0 THEN ROUND(clicks::NUMERIC / impressions, 6)       ELSE 0 END AS ctr,
  CASE WHEN clicks > 0    THEN ROUND(spend / clicks, 4)                        ELSE 0 END AS cpc,
  CASE WHEN impressions > 0 THEN ROUND(spend / impressions * 1000, 4)          ELSE 0 END AS cpm
FROM with_all
ON CONFLICT (ad_account_id, campaign_id, date) DO NOTHING;

-- ─── Sync Logs ─────────────────────────────────────────────────────────────────
INSERT INTO sync_logs (
  client_id, ad_account_id, platform, status,
  records_synced, date_range_start, date_range_end,
  started_at, completed_at
) VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    'google', 'success', 270,
    CURRENT_DATE - 89, CURRENT_DATE,
    NOW() - INTERVAL '2 hours',
    NOW() - INTERVAL '2 hours' + INTERVAL '47 seconds'
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    '33333333-3333-3333-3333-333333333333',
    'meta', 'success', 180,
    CURRENT_DATE - 89, CURRENT_DATE,
    NOW() - INTERVAL '2 hours' + INTERVAL '52 seconds',
    NOW() - INTERVAL '2 hours' + INTERVAL '90 seconds'
  );
