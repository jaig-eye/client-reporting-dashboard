-- ─────────────────────────────────────────────────────────────────────────────
-- 022_dummy_data.sql
-- Demo client "Apex Roofing Co." with realistic Google Ads + Meta Ads data.
-- Run this against your Supabase database to explore the dashboard.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Client ────────────────────────────────────────────────────────────────
INSERT INTO clients (id, name, dashboard_token, status, ad_fuel_cut)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'Apex Roofing Co.',
  'demo_apex_roofing_2024',
  'active',
  NULL
)
ON CONFLICT (id) DO NOTHING;

-- ── 2. Connectors (agency-level) ─────────────────────────────────────────────
INSERT INTO connectors (id, source, label, credentials, status)
VALUES
  (
    'bbbbbbbb-0001-0000-0000-000000000001',
    'google_ads',
    'Demo Google Ads Connector',
    '{"developer_token":"DEMO","client_id":"DEMO","client_secret":"DEMO","refresh_token":"DEMO","customer_id":"1234567890"}',
    'active'
  ),
  (
    'bbbbbbbb-0002-0000-0000-000000000001',
    'meta_ads',
    'Demo Meta Ads Connector',
    '{"app_id":"DEMO","app_secret":"DEMO","access_token":"DEMO","ad_account_id":"act_1234567890"}',
    'active'
  )
ON CONFLICT (id) DO NOTHING;

-- ── 3. Client connections ─────────────────────────────────────────────────────
INSERT INTO client_connections (id, client_id, connector_id, status)
VALUES
  (
    'cccccccc-0001-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'bbbbbbbb-0001-0000-0000-000000000001',
    'active'
  ),
  (
    'cccccccc-0002-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'bbbbbbbb-0002-0000-0000-000000000001',
    'active'
  )
ON CONFLICT (id) DO NOTHING;

-- ── 4. Campaign → category assignments ───────────────────────────────────────
-- campaign_categories is agency-wide (seeded in 017). We look up by name.
INSERT INTO client_campaign_assignments
  (client_id, source, campaign_id, campaign_name, category_id)
VALUES
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'google_ads', 'goog_camp_001', 'Branded – Roofing Services',
    (SELECT id FROM campaign_categories WHERE name = 'Lead Generation' LIMIT 1)
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'google_ads', 'goog_camp_002', 'Competitors – Best Roofers',
    (SELECT id FROM campaign_categories WHERE name = 'Lead Generation' LIMIT 1)
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'google_ads', 'goog_camp_003', 'Display Retargeting',
    (SELECT id FROM campaign_categories WHERE name = 'Retargeting' LIMIT 1)
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'meta_ads', 'meta_camp_001', 'Facebook Lead Ads – Roof Inspections',
    (SELECT id FROM campaign_categories WHERE name = 'Lead Generation' LIMIT 1)
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'meta_ads', 'meta_camp_002', 'Instagram Awareness – Storm Season',
    (SELECT id FROM campaign_categories WHERE name = 'Brand Awareness' LIMIT 1)
  )
ON CONFLICT (client_id, source, campaign_id) DO NOTHING;

-- ── 5. Google Ads campaign metrics (30 days, 3 campaigns) ────────────────────
-- NOTE: column is conversions_value (not conversion_value); client_id required
INSERT INTO google_ads_metrics (
  connection_id, client_id, campaign_id, campaign_name, date,
  spend, impressions, clicks, conversions, conversions_value
)
SELECT
  'cccccccc-0001-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'goog_camp_001', 'Branded – Roofing Services', d::date,
  ROUND((18 + random() * 10 + CASE WHEN EXTRACT(dow FROM d) IN (1,2,3,4,5) THEN 4 ELSE 0 END)::numeric, 2),
  (900  + floor(random() * 500))::int,
  (55   + floor(random() * 35))::int,
  ROUND((4 + random() * 5)::numeric, 4),
  ROUND((4 + random() * 5) * (350 + random() * 60)::numeric, 2)
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, campaign_id, date) DO NOTHING;

INSERT INTO google_ads_metrics (
  connection_id, client_id, campaign_id, campaign_name, date,
  spend, impressions, clicks, conversions, conversions_value
)
SELECT
  'cccccccc-0001-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'goog_camp_002', 'Competitors – Best Roofers', d::date,
  ROUND((35 + random() * 20)::numeric, 2),
  (2500 + floor(random() * 1000))::int,
  (90   + floor(random() * 50))::int,
  ROUND((3 + random() * 6)::numeric, 4),
  ROUND((3 + random() * 6) * (300 + random() * 80)::numeric, 2)
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, campaign_id, date) DO NOTHING;

INSERT INTO google_ads_metrics (
  connection_id, client_id, campaign_id, campaign_name, date,
  spend, impressions, clicks, conversions, conversions_value
)
SELECT
  'cccccccc-0001-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'goog_camp_003', 'Display Retargeting', d::date,
  ROUND((8 + random() * 6)::numeric, 2),
  (12000 + floor(random() * 5000))::int,
  (20    + floor(random() * 20))::int,
  ROUND((0.5 + random() * 1.5)::numeric, 4),
  ROUND((0.5 + random() * 1.5) * (200 + random() * 100)::numeric, 2)
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, campaign_id, date) DO NOTHING;

-- ── 6. Meta Ads campaign metrics (30 days, 2 campaigns) ──────────────────────
-- NOTE: client_id required; actions/action_values required (NOT NULL DEFAULT '[]')
INSERT INTO meta_ads_metrics (
  connection_id, client_id, campaign_id, campaign_name, date,
  spend, impressions, clicks,
  conversions, conversion_value,
  actions, action_values
)
SELECT
  'cccccccc-0002-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'meta_camp_001', 'Facebook Lead Ads – Roof Inspections', d::date,
  ROUND((45 + random() * 25)::numeric, 2),
  (8000 + floor(random() * 4000))::int,
  (120  + floor(random() * 80))::int,
  ROUND((5 + random() * 8)::numeric, 4),
  ROUND((5 + random() * 8) * (280 + random() * 80)::numeric, 2),
  '[{"action_type":"lead","value":"5"}]'::jsonb,
  '[]'::jsonb
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, campaign_id, date) DO NOTHING;

INSERT INTO meta_ads_metrics (
  connection_id, client_id, campaign_id, campaign_name, date,
  spend, impressions, clicks,
  conversions, conversion_value,
  actions, action_values
)
SELECT
  'cccccccc-0002-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'meta_camp_002', 'Instagram Awareness – Storm Season', d::date,
  ROUND((20 + random() * 10)::numeric, 2),
  (25000 + floor(random() * 10000))::int,
  (60    + floor(random() * 40))::int,
  ROUND((0.5 + random() * 2)::numeric, 4),
  ROUND((0.5 + random() * 2) * (150 + random() * 100)::numeric, 2),
  '[{"action_type":"post_engagement","value":"1"}]'::jsonb,
  '[]'::jsonb
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, campaign_id, date) DO NOTHING;

-- ── 7. Google Ads ad-level metrics (6 ads, 30 days each) ─────────────────────
-- NOTE: google_ads_ad_metrics requires client_id (NOT NULL)

INSERT INTO google_ads_ad_metrics (
  connection_id, client_id, campaign_id, ad_id, ad_name, ad_type,
  ad_group_id, ad_group_name, date,
  spend, impressions, clicks, conversions, conversions_value
)
SELECT
  'cccccccc-0001-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'goog_camp_001', 'goog_ad_001',
  'Apex Roofing | Free Estimate | Call Now',
  'EXPANDED_TEXT_AD',
  'goog_ag_001', 'Branded – Exact', d::date,
  ROUND((8 + random() * 5)::numeric, 2),
  (400 + floor(random() * 200))::int,
  (25  + floor(random() * 15))::int,
  ROUND((2 + random() * 2)::numeric, 4),
  ROUND((2 + random() * 2) * (360 + random() * 40)::numeric, 2)
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, ad_id, date) DO NOTHING;

INSERT INTO google_ads_ad_metrics (
  connection_id, client_id, campaign_id, ad_id, ad_name, ad_type,
  ad_group_id, ad_group_name, date,
  spend, impressions, clicks, conversions, conversions_value
)
SELECT
  'cccccccc-0001-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'goog_camp_001', 'goog_ad_002',
  '#1 Roofing Company | Apex | Same Day',
  'RESPONSIVE_SEARCH_AD',
  'goog_ag_001', 'Branded – Exact', d::date,
  ROUND((6 + random() * 4)::numeric, 2),
  (300 + floor(random() * 150))::int,
  (18  + floor(random() * 12))::int,
  ROUND((1.5 + random() * 2)::numeric, 4),
  ROUND((1.5 + random() * 2) * (340 + random() * 60)::numeric, 2)
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, ad_id, date) DO NOTHING;

INSERT INTO google_ads_ad_metrics (
  connection_id, client_id, campaign_id, ad_id, ad_name, ad_type,
  ad_group_id, ad_group_name, date,
  spend, impressions, clicks, conversions, conversions_value
)
SELECT
  'cccccccc-0001-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'goog_camp_001', 'goog_ad_003',
  'Local Roofing Experts | 20yr Warranty',
  'RESPONSIVE_SEARCH_AD',
  'goog_ag_002', 'Branded – Phrase', d::date,
  ROUND((4 + random() * 4)::numeric, 2),
  (200 + floor(random() * 150))::int,
  (12  + floor(random() * 10))::int,
  ROUND((0.5 + random() * 1.5)::numeric, 4),
  ROUND((0.5 + random() * 1.5) * (320 + random() * 80)::numeric, 2)
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, ad_id, date) DO NOTHING;

INSERT INTO google_ads_ad_metrics (
  connection_id, client_id, campaign_id, ad_id, ad_name, ad_type,
  ad_group_id, ad_group_name, date,
  spend, impressions, clicks, conversions, conversions_value
)
SELECT
  'cccccccc-0001-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'goog_camp_002', 'goog_ad_004',
  'Switch From Competitor | Apex Roofing',
  'RESPONSIVE_SEARCH_AD',
  'goog_ag_003', 'Competitor – Generic', d::date,
  ROUND((20 + random() * 12)::numeric, 2),
  (1400 + floor(random() * 600))::int,
  (55   + floor(random() * 30))::int,
  ROUND((2 + random() * 3)::numeric, 4),
  ROUND((2 + random() * 3) * (290 + random() * 90)::numeric, 2)
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, ad_id, date) DO NOTHING;

INSERT INTO google_ads_ad_metrics (
  connection_id, client_id, campaign_id, ad_id, ad_name, ad_type,
  ad_group_id, ad_group_name, date,
  spend, impressions, clicks, conversions, conversions_value
)
SELECT
  'cccccccc-0001-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'goog_camp_002', 'goog_ad_005',
  'Better Than The Rest | Free Roof Quote',
  'EXPANDED_TEXT_AD',
  'goog_ag_003', 'Competitor – Generic', d::date,
  ROUND((15 + random() * 10)::numeric, 2),
  (1100 + floor(random() * 500))::int,
  (35   + floor(random() * 25))::int,
  ROUND((1 + random() * 3)::numeric, 4),
  ROUND((1 + random() * 3) * (300 + random() * 80)::numeric, 2)
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, ad_id, date) DO NOTHING;

INSERT INTO google_ads_ad_metrics (
  connection_id, client_id, campaign_id, ad_id, ad_name, ad_type,
  ad_group_id, ad_group_name, date,
  spend, impressions, clicks, conversions, conversions_value
)
SELECT
  'cccccccc-0001-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'goog_camp_003', 'goog_ad_006',
  'Apex Roofing – Retargeting Banner',
  'RESPONSIVE_DISPLAY_AD',
  'goog_ag_004', 'Retargeting – All Visitors', d::date,
  ROUND((8 + random() * 6)::numeric, 2),
  (12000 + floor(random() * 5000))::int,
  (20    + floor(random() * 20))::int,
  ROUND((0.5 + random() * 1.5)::numeric, 4),
  ROUND((0.5 + random() * 1.5) * (200 + random() * 100)::numeric, 2)
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, ad_id, date) DO NOTHING;

-- ── 8. Meta Ads ad-level metrics (4 ads, 30 days each) ───────────────────────
-- NOTE: meta_ads_ad_metrics requires client_id (NOT NULL). No ad_type column.

INSERT INTO meta_ads_ad_metrics (
  connection_id, client_id, campaign_id, ad_id, ad_name,
  adset_id, adset_name, date,
  spend, impressions, clicks,
  conversions, conversion_value,
  actions, action_values
)
SELECT
  'cccccccc-0002-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'meta_camp_001', 'meta_ad_001',
  'Roof damage? Get a FREE inspection this week',
  'meta_adset_001', 'Lead Gen – Homeowners 35-65', d::date,
  ROUND((22 + random() * 12)::numeric, 2),
  (4000 + floor(random() * 2000))::int,
  (65   + floor(random() * 40))::int,
  ROUND((3 + random() * 4)::numeric, 4),
  ROUND((3 + random() * 4) * (270 + random() * 80)::numeric, 2),
  '[{"action_type":"lead","value":"3"},{"action_type":"link_click","value":"65"}]'::jsonb,
  '[]'::jsonb
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, ad_id, date) DO NOTHING;

INSERT INTO meta_ads_ad_metrics (
  connection_id, client_id, campaign_id, ad_id, ad_name,
  adset_id, adset_name, date,
  spend, impressions, clicks,
  conversions, conversion_value,
  actions, action_values
)
SELECT
  'cccccccc-0002-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'meta_camp_001', 'meta_ad_002',
  'Video: Before & After Storm Damage Repairs',
  'meta_adset_001', 'Lead Gen – Homeowners 35-65', d::date,
  ROUND((23 + random() * 14)::numeric, 2),
  (4200 + floor(random() * 2200))::int,
  (55   + floor(random() * 40))::int,
  ROUND((2 + random() * 4)::numeric, 4),
  ROUND((2 + random() * 4) * (290 + random() * 70)::numeric, 2),
  '[{"action_type":"lead","value":"2"},{"action_type":"video_view","value":"1200"},{"action_type":"link_click","value":"55"}]'::jsonb,
  '[]'::jsonb
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, ad_id, date) DO NOTHING;

INSERT INTO meta_ads_ad_metrics (
  connection_id, client_id, campaign_id, ad_id, ad_name,
  adset_id, adset_name, date,
  spend, impressions, clicks,
  conversions, conversion_value,
  actions, action_values
)
SELECT
  'cccccccc-0002-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'meta_camp_002', 'meta_ad_003',
  'Storm Season Is Here – Protect Your Home',
  'meta_adset_002', 'Awareness – Broad 25-55', d::date,
  ROUND((12 + random() * 7)::numeric, 2),
  (14000 + floor(random() * 6000))::int,
  (35    + floor(random() * 25))::int,
  ROUND((0.5 + random() * 1.5)::numeric, 4),
  ROUND((0.5 + random() * 1.5) * (160 + random() * 80)::numeric, 2),
  '[{"action_type":"post_engagement","value":"450"},{"action_type":"link_click","value":"35"}]'::jsonb,
  '[]'::jsonb
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, ad_id, date) DO NOTHING;

INSERT INTO meta_ads_ad_metrics (
  connection_id, client_id, campaign_id, ad_id, ad_name,
  adset_id, adset_name, date,
  spend, impressions, clicks,
  conversions, conversion_value,
  actions, action_values
)
SELECT
  'cccccccc-0002-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'meta_camp_002', 'meta_ad_004',
  'Brand Video – The Apex Roofing Story',
  'meta_adset_002', 'Awareness – Broad 25-55', d::date,
  ROUND((8 + random() * 5)::numeric, 2),
  (11000 + floor(random() * 5000))::int,
  (25    + floor(random() * 20))::int,
  ROUND((0.2 + random() * 0.8)::numeric, 4),
  ROUND((0.2 + random() * 0.8) * (120 + random() * 80)::numeric, 2),
  '[{"action_type":"video_view","value":"2800"},{"action_type":"link_click","value":"25"}]'::jsonb,
  '[]'::jsonb
FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d
ON CONFLICT (connection_id, ad_id, date) DO NOTHING;
