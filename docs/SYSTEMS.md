# SYSTEMS.md — Complete Systems Reference

## Environment Variables

| Variable | Required | Description | Used In |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL | `lib/supabase/client.ts`, `lib/supabase/server.ts` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Public anon key for browser-side reads | `lib/supabase/client.ts` |
| `SUPABASE_SECRET_KEY` | yes | Service role key; bypasses RLS | `lib/supabase/server.ts` (`createAdminClient`) |
| `GOOGLE_CLIENT_ID` | yes | OAuth 2.0 client ID | `lib/google-ads.ts`, `lib/connectors/google-ads.ts` |
| `GOOGLE_CLIENT_SECRET` | yes | OAuth 2.0 client secret | Same as above |
| `GOOGLE_DEVELOPER_TOKEN` | yes | Google Ads API developer token | `lib/google-ads.ts`, `lib/connectors/google-ads.ts` |
| `GOOGLE_MCC_CUSTOMER_ID` | yes | Manager account ID for login-customer-id header | `lib/google-ads.ts`, `lib/connectors/google-ads.ts` |
| `META_APP_ID` | yes | Facebook App ID | `lib/meta-ads.ts`, `lib/connectors/meta-ads.ts` |
| `META_APP_SECRET` | yes | Facebook App Secret | Same as above |
| `NEXT_PUBLIC_APP_URL` | yes | Full app URL (e.g. `https://dash.golaunchlocal.com`) | OAuth redirect URIs, email links |
| `ADMIN_PASSWORD` | yes | Master password for super-admin login and `admin_session` cookie value | `lib/auth.ts`, all API routes using `isAdminAuthed` |
| `CRON_SECRET` | yes | Bearer token for Vercel cron job authorization | All `/api/cron/*` routes |
| `INGEST_SECRET` | yes | `x-ingest-secret` header for MCC push endpoints | `/api/ingest/google`, `/api/ingest/meta` |
| `ADFUEL_API_KEY` | yes | `x-api-key` header for the GHL sidebar widget | `/api/adfuel` |
| `PEXELS_API_KEY` | no (recommended) | Free stock photos offered in the review drawer as an alternative to the AI-generated featured image. Openverse and Wikimedia Commons always run and need no key; Pexels is the highest-quality source and is the only one that covers industrial/B2B topics well. Free key from pexels.com/api; the free tier is 200 req/hour and 20,000/month, and the hourly cap is the reachable one. Unset ⇒ Pexels is skipped and the other two still work. | `lib/content/stockImages.ts` |
| `MAILGUN_SMTP_HOST` | yes | SMTP host (default `smtp.mailgun.org`) | `lib/email.ts` |
| `MAILGUN_SMTP_PORT` | yes | SMTP port (default `587`) | `lib/email.ts` |
| `MAILGUN_SMTP_USER` | yes | SMTP username | `lib/email.ts` |
| `MAILGUN_SMTP_PASS` | yes | SMTP password | `lib/email.ts` |
| `MAILGUN_FROM` | no | From address; falls back to `MAILGUN_SMTP_USER` | `lib/email.ts` |
| `GEMINI_API_KEY` | no | Gemini API key for image generation fallback | `lib/content/generatePostImage.ts` |
| `OPENAI_API_KEY` | no | OpenAI API key (also stored in `agency_settings.openai_api_key`/`ai_api_key`) | Content generation, image generation |
| `VERCEL_URL` | auto | Set by Vercel; used internally for URL construction | Next.js runtime |
| `NODE_ENV` | auto | `production` or `development`; affects cookie security flags | `lib/auth.ts` |

Additional keys stored in the database (not env vars) and loaded at runtime:
- `agency_settings.stripe_api_key` — Stripe secret key
- `agency_settings.stripe_webhook_secret` — Stripe webhook verification
- `agency_settings.ai_api_key` — Anthropic or OpenAI key for content generation
- `agency_settings.discord_bot_token` — Discord bot for alerts
- `agency_settings.serp_api_key` — SerpAPI for competitor research

---

## Database Tables by Domain

### Core Client Tables

**`clients`**
Key columns: `id` (UUID PK), `name`, `email` (nullable unique), `slug` (unique), `logo_url`, `dashboard_token` (UUID, unique — client portal access key), `default_conversion_value`, `ad_fuel_cut` (DECIMAL, overrides agency default), `lead_action`, `lead_action_fallback`, `purchase_action`, `purchase_action_fallback`, `benchmark_roas/ctr/cpc/conv_rate/cpm/cpl` (all nullable), `show_benchmarks`, `hidden_metrics`, `enabled_benchmarks`, `metric_layout_override` (JSONB), `layout_type`, `bill_day` (1–31), `historic_bill_day` (1–31), `monthly_budget`, `discord_channel_id`, `local_dominator_url`, `stripe_customer_id`, `ad_fuel_alert_threshold`, `last_fuel_alert_at`, `last_fuel_alert_balance`, `ad_fuel_alert_muted`, `auto_pause_ads`, `auto_resume_ads`, `campaigns_paused_at`, `bc_daily_report`, `last_runway_alert_at`, `last_runway_alert_days`, `created_at`, `updated_at`.

**`agency_settings`** (single row)
Key columns: `agency_name`, `agency_logo_url`, `favicon_url`, `crm_name`, `benchmark_*` (6 fields), `default_date_range_days`, `default_conversion_value`, `ad_fuel_cut`, `ad_fuel_cutoff_date`, `default_lead_action`, `default_lead_action_fallback`, `default_purchase_action`, `default_purchase_action_fallback`, `cron_enabled`, `app_version`, `ads_sync_frequency`, `ads_sync_hour_utc`, `sync_frequency`, `sync_hour_utc`, `sync_day_of_week`, `chart_color_spend/prior_spend/conversions/prior_conversions`, `ai_provider`, `ai_model`, `ai_api_key`, `openai_api_key`, `metric_layouts` (JSONB), `hidden_connector_types` (TEXT[]), `discord_bot_token`, `stripe_api_key`, `stripe_webhook_secret`, `serp_api_key`, `serp_api_provider`, `brand_primary`, `notify_metric_alerts`, `metric_alert_threshold`, `daily_alert_threshold`, `daily_alert_metrics` (JSONB), `weekly_alert_metrics` (JSONB), `notify_connector_errors`, `notify_topic_ready`, `notify_post_uploaded`, `master_writing_prompt`, `service_area_master_prompt`, `super_admin_otp_hash`, `super_admin_otp_expires_at`, `image_generation_enabled`.

**`users`**
Columns: `id`, `name`, `email` (unique), `username` (unique on `LOWER(username)`), `password_hash`, `role` (admin|viewer), `is_active`, `last_login_at`, `avatar_url`, `theme` (light|dark|auto), `accent_color`, `created_at`, `updated_at`.

**`activity_log`**
Columns: `id`, `user_id` (FK to users, SET NULL on delete), `user_name`, `action`, `resource_type`, `resource_id`, `client_id` (FK to clients, SET NULL), `client_name`, `meta` (JSONB), `created_at`.

**`password_reset_tokens`**
Columns: `id`, `user_id` (FK CASCADE), `token_hash` (unique SHA-256 hex), `expires_at`, `used_at`, `created_at`.

---

### Connector Tables

**`connectors`** (agency-level platform credentials)
Key columns: `id`, `type` (one of 9 ConnectorType values), `label`, `status` (active|error|disconnected|pending), `auth` (JSONB — tokens, credentials), `config` (JSONB — extra config like `mcc_customer_id`, `site_url`), `last_checked_at`. Unique index on `type` WHERE type IN (the 6 singleton connector types).

**`connector_accounts`** (discovered accounts within a connector)
Key columns: `id`, `connector_id` (FK), `external_id`, `external_name`, `metadata` (JSONB), `is_linked`, `created_at`, `updated_at`. Unique on `(connector_id, external_id)`.

**`client_connections`** (links a client to one platform account)
Key columns: `id`, `client_id` (FK), `connector_id` (FK), `external_id` (platform account ID), `external_name`, `status` (active|paused|error), `last_synced_at`, `sync_from` (DATE — don't sync before this), `config` (JSONB — e.g. `property_id` for GA4, `site_url` for GSC, `page_filter_regex`), `created_at`, `updated_at`.

---

### Sync / Job Tables

**`sync_jobs`**
Columns: `id`, `connection_id` (FK), `client_id` (FK), `job_type` (backfill|incremental|manual), `status` (running|success|error), `records_synced`, `error_message`, `date_from`, `date_to`, `progress_pct` (SMALLINT 0–100), `progress_note`, `started_at`, `completed_at`.

---

### Ad Platform Metric Tables

**`google_ads_metrics`** (campaign-level daily rows)
Unique key: `(connection_id, campaign_id, date)`.
Key columns: `client_id`, `campaign_id`, `campaign_name`, `campaign_status`, `campaign_type`, `date`, `cost_micros`, `spend`, `daily_budget`, `impressions`, `clicks`, `conversions`, `conversions_value`, `all_conversions_value`, `view_through_conversions`, `roas`, `ctr`, `cpc`, `cpm`, `search_impression_share`, `search_abs_top_impression_share`, `search_top_impression_share`.

**`meta_ads_metrics`** (campaign-level daily rows)
Unique key: `(connection_id, campaign_id, date)`.
Key columns: `client_id`, `campaign_id`, `campaign_name`, `objective`, `date`, `spend`, `impressions`, `clicks`, `reach`, `frequency`, `actions` (JSONB array of MetaAction), `action_values` (JSONB array of MetaAction), `conversions`, `conversion_value`, `roas`, `ctr`, `cpc`, `cpm`, `discovered_actions` (TEXT[]).

**`google_ads_ad_metrics`** (ad-level daily rows)
Unique key: `(connection_id, ad_id, date)`.
Key columns: `client_id`, `campaign_id`, `campaign_name`, `ad_group_id`, `ad_group_name`, `ad_id`, `ad_name`, `ad_type`, `ad_status`, `ad_strength`, `headlines` (TEXT[]), `descriptions` (TEXT[]), `final_url`, `image_url`, `date`, `spend`, `impressions`, `clicks`, `conversions`, `conversions_value`, `all_conversions_value`.

**`meta_ads_ad_metrics`** (ad-level daily rows)
Unique key: `(connection_id, ad_id, date)`.
Key columns: `client_id`, `campaign_id`, `campaign_name`, `adset_id`, `adset_name`, `ad_id`, `ad_name`, `thumbnail_url`, `image_url`, `video_id`, `video_thumb_url`, `creative_body`, `creative_title`, `creative_link_url`, `ad_status`, `date`, `spend`, `impressions`, `clicks`, `reach`, `actions` (JSONB), `action_values` (JSONB), `conversions`, `conversion_value`.

**`google_ads_keywords`** (keyword-level daily rows)
Unique key: `(connection_id, keyword_id, date)`.
Columns: `campaign_id`, `campaign_name`, `ad_group_id`, `ad_group_name`, `keyword_id`, `keyword_text`, `match_type`, `keyword_status`, `date`, `cost_micros`, `impressions`, `clicks`, `conversions`, `conversions_value`.

**`google_ads_negative_keywords`** (negative keywords, non-time-series)
Unique key: `(connection_id, keyword_id, level)`.
Columns: `campaign_id`, `campaign_name`, `ad_group_id`, `ad_group_name`, `keyword_id`, `keyword_text`, `match_type`, `level` (campaign|adgroup).

**`google_ads_asset_group_assets`** (PMax asset groups)
Unique key: `(connection_id, asset_group_id, asset_id, field_type)`.
Columns: `campaign_id`, `campaign_name`, `asset_group_id`, `asset_group_name`, `asset_id`, `field_type`, `text_content`, `image_url`, `video_id`.

---

### Analytics Tables

**`ga4_metrics`** (GA4 channel-group daily rows)
Unique key: `(connection_id, date, channel_group)`.
Columns: `client_id`, `date`, `channel_group`, `sessions`, `users`, `new_users`, `page_views`, `bounce_rate`, `avg_session_duration`, `conversions`, `engaged_sessions`, `raw_data`, `synced_at`.

**`ga4_source_metrics`** (GA4 source/medium/campaign daily rows)
Unique key: `(connection_id, date, source, medium, campaign)`.
Columns: `client_id`, `date`, `source`, `medium`, `campaign`, `sessions`, `users`, `new_users`, `page_views`, `conversions`, `engaged_sessions`, `synced_at`.

**`gsc_metrics`** (raw GSC query+page rows — large, avoid for aggregates)
Unique key: `(connection_id, date, query, page)`.
Columns: `client_id`, `date`, `query`, `page`, `clicks`, `impressions`, `ctr`, `position`.

**`gsc_daily_totals`** (GSC daily aggregate)
Unique key: `(connection_id, date)`.
Columns: `client_id`, `date`, `clicks`, `impressions`, `ctr`, `position`, `synced_at`.

**`gsc_query_totals`** (GSC per-query daily aggregate)
Unique key: `(connection_id, date, query)`.
Columns: `client_id`, `date`, `query`, `clicks`, `impressions`, `ctr`, `position`, `synced_at`.

**`gsc_page_totals`** (GSC per-page daily aggregate)
Unique key: `(connection_id, date, page)`.
Columns: `client_id`, `date`, `page`, `clicks`, `impressions`, `ctr`, `position`, `synced_at`.

**`gbp_metrics`** (Google Business Profile daily rows)
Unique key: `(connection_id, location_id, date)`.
Columns: `client_id`, `location_id`, `location_name`, `date`, `views_search`, `views_maps`, `website_clicks`, `call_clicks`, `direction_clicks`, `reviews_count`, `reviews_avg_rating`.

**`ahrefs_metrics`** (weekly domain authority snapshots)
Unique key: `(connection_id, date)`.
Columns: `client_id`, `date`, `domain_rating`, `ahrefs_rank`, `backlinks`, `referring_domains`, `organic_keywords`, `organic_traffic`, `traffic_value`, `paid_keywords`, `paid_traffic`, `new_backlinks`, `lost_backlinks`, `new_referring_domains`, `lost_referring_domains`, `raw_data`, `synced_at`.

**`ahrefs_keywords`** (top keywords per snapshot date)
Unique key: `(connection_id, date, keyword)`.
Columns: `client_id`, `date`, `keyword`, `position`, `volume`, `traffic`, `difficulty`.

**`ahrefs_pages`** (top pages per snapshot date)
Unique key: `(connection_id, date, url)`.
Columns: `client_id`, `date`, `url`, `organic_traffic`, `organic_keywords`.

**`ghl_metrics`** (GoHighLevel CRM daily snapshots)
Unique key: `(connection_id, date)`.
Columns: `client_id`, `date`, `contacts_created`, `total_calls`, `incoming_calls`, `outgoing_calls`, `missed_calls`, `forms_submitted`, `reviews_sent`, `reviews_received`, `spam_leads`, `emails_sent`, `sms_sent`, `new_opportunities`, `won_opportunities`, `lost_opportunities`, `won_value`, `raw_data`, `synced_at`.

---

### Ad Fuel Tables

**`ad_fuel_ledger`**
Columns: `id`, `client_id` (FK CASCADE), `date_of_payment` (DATE), `invoice_date` (DATE), `amount_af` (DECIMAL 12,2), `split_override` (DECIMAL 5,4 — 0 to 1), `invoice_id`, `type` (MRR|One-Time|ACH), `ach_status` (pending|cleared), `note`, `created_by`, `created_at`.

**`ad_fuel_ach_pending`**
Tracks in-flight ACH Stripe invoices awaiting payment clearance.
Columns: `id`, `client_id`, `invoice_id` (unique per client), `amount_af`, `date_of_payment`, `created_at`.

**`ad_pause_log`**
Columns: `id`, `client_id` (FK CASCADE), `action` (paused|resumed|pause_failed|resume_failed), `trigger` (auto|manual), `balance`, `google_campaigns_affected`, `meta_campaigns_affected`, `paused_campaign_ids` (JSONB: `{ google: [...], meta: [...] }`), `error`, `created_at`.

---

### Alerts Tables

**`metric_alerts`**
Columns: `id`, `client_id` (FK CASCADE), `metric`, `current_val`, `prior_val`, `pct_change`, `direction`, `insight`, `alert_type` (daily|weekly), `platform`, `date_label`, `dismissed_at`, `created_at`.

**`admin_alerts`**
Columns: `id`, `type` (ad_insights|ad_fuel|content|integration), `severity` (info|warning|critical), `client_id` (FK CASCADE nullable), `client_name`, `title`, `body`, `meta` (JSONB), `link_url`, `read_at`, `dismissed_at`, `created_at`.

---

### Campaign Management Tables

**`campaign_categories`**
Columns: `id`, `name`, `color`, `description`, `display_mode` (lead_gen|ecommerce|awareness|engagement|custom), `default_conversion_value`, `conversion_label`, `is_default`, `sort_order`, `created_at`, `updated_at`.

**`client_campaign_assignments`**
Columns: `id`, `client_id` (FK), `source` (google_ads|meta_ads), `campaign_id`, `campaign_name`, `category_id` (FK nullable), `conversion_value_override`, `meta_conversion_action`, `display_mode`, `conversion_label`, `hidden`, `notes`, `created_at`, `updated_at`.

---

### Content Tables

**`content_settings`** (one row per client, or client_id IS NULL for global)
Key columns: `client_id`, `background`, `services`, `target_audience`, `geographic_focus`, `brand_voice`, `phone_number`, `cta_list`, `sitemap_urls` (TEXT[]), `manual_link_urls` (TEXT[]), `eeat_data` (JSONB — 15 fields), `auto_generate`, `auto_approve_topics`, `auto_push_posts`, `schedule_frequency`, `schedule_day_of_week`, `monthly_publish_day`, `topics_per_run`, `posts_per_run`, `weeks_ahead`, `target_length`, `publish_time`, `wp_publish_mode` (scheduled_draft|draft_only), `topic_guidelines`, `wizard_completed`, `post_structure`, `notification_email`.

**`content_topics`**
Key columns: `id`, `client_id` (FK), `content_type` (blog|service_area), `status` (pending|approved|rejected|generating|generated|scheduled), `topic`, `target_keyword`, `search_intent`, `secondary_keywords`, `keyword_opportunity`, `ranking_strategy`, `audience_intent`, `why_now`, `competition_level`, `cluster_group`, `seo_brief` (JSONB — 28 fields), `competitors_researched` (JSONB), `edit_notes`, `target_publish_date`, `auto_approved_at`, `generation_error`, `city`, `state_abbr`, `service_name`, `created_at`, `updated_at`.

**`content_posts`**
Key columns: `id`, `client_id` (FK), `topic_id` (FK nullable), `content_type` (blog|service_area), `status` (pending|for_review|draft_saved|published|rejected), `title`, `seo_title`, `content` (HTML), `excerpt`, `meta_description`, `slug`, `target_keyword`, `suggested_tags`, `seo_score` (JSONB — 17 fields), `featured_image_url`, `featured_image_prompt`, `featured_image_source`, `image_generation_error`, `wp_post_id`, `wp_status`, `wp_site_url`, `bc_post_id`, `bc_store_hash`, `published_url`, `target_publish_date`, `auto_pushed_at`, `auto_push_error`, `generated_by` (scheduled|manual|topic), `topic_rationale`, `city`, `state_abbr`, `service_name`, `service_page_url`, `created_at`, `updated_at`.

**`content_sitemap_pages`**
Unique key: `(client_id, url)`.
Columns: `id`, `client_id` (FK CASCADE), `url`, `title`, `is_priority`, `is_excluded`, `is_service_page`, `created_at`.

**`service_area_settings`** (one row per client, unique `client_id`)
Columns: `id`, `client_id` (FK unique), `connection_id` (FK nullable), `slug_structure`, `service_pages` (JSONB), `service_areas` (JSONB), `nearby_areas_template`, `primary_service`, `auto_generate`, `auto_approve_pages`, `auto_push_pages`, `wp_publish_mode`, `schedule_frequency`, `schedule_day_of_week`, `pages_per_run` (1–10), `publish_time`, `target_length` (600–3000), `page_structure`, `location_notes`, `tone_notes`, `use_gsc_discovery`, `min_gsc_impressions`, `check_sitemap_overlap`, `created_at`, `updated_at`.

---

## Supabase RPCs / Functions

| Function | Signature | Description |
|---|---|---|
| `get_gsc_summary` | `(p_client_id, p_connection_id, p_date_from, p_date_to, p_top_n=25)` | Returns JSON with `totals`, `queries` (top N), `pages` (top N), `daily` series, `pos_dist`. Uses `gsc_daily_totals` + `gsc_query_totals` + `gsc_page_totals` with per-date fallback to `gsc_metrics`. |
| `sum_google_spend_by_client` | `(from_date DATE, to_date DATE DEFAULT NULL)` | Sums `google_ads_metrics.spend` per client from cutoff date. Updated in migration 135 to use ad-level table. |
| `sum_meta_spend_by_client` | `(from_date DATE, to_date DATE DEFAULT NULL)` | Sums `meta_ads_ad_metrics.spend` per client. Uses ad-level table (migration 135 fix). |
| `daily_google_spend_by_client` | `(floor_date DATE)` | Returns `(client_id, date, spend)` rows from `google_ads_metrics`. |
| `daily_meta_spend_by_client` | `(floor_date DATE)` | Returns `(client_id, date, spend)` rows from `meta_ads_ad_metrics` (migration 135 fix). |
| `lifetime_google_spend_by_client` | `(cutoff_date DATE)` | Alias pattern for summing from cutoff; same as `sum_google_spend_by_client` with open-ended to_date. |
| `lifetime_meta_spend_by_client` | `(cutoff_date DATE)` | Same for Meta. |
| `get_client_data_coverage` | `(p_client_id UUID)` | Returns table of `(source, min_date, max_date, days_with_data)` for each metric table. |
| `latest_campaign_budget_by_client` | `()` | Returns `(client_id, google_daily_budget, meta_daily_budget)` from the most-recent date in campaign metric tables. |

---

## Cron Jobs

All cron jobs in `vercel.json` use `Authorization: Bearer CRON_SECRET` for auth (except `cleanup-rejected-topics` which uses `x-cron-secret` header or `?secret=` param).

| Route | Schedule | What it does |
|---|---|---|
| `/api/cron/sync` | Hourly (`0 * * * *`) | Master data sync. Ads connectors (Google Ads, Meta Ads) on `ads_sync_frequency` schedule; all other connectors (GA4, GSC, GBP, GHL, Ahrefs, WordPress, Ahrefs, BigCommerce) on `sync_frequency` schedule. Uses `syncClient()` per client in parallel via `Promise.allSettled`. Sends error email on OAuth failure if `notify_connector_errors`. |
| `/api/cron/ad-fuel-alerts` | 10 min past every hour | Sends Discord alerts when a client's Ad Fuel balance drops below threshold or hits zero. Computes balance from spend RPCs + ledger. Fires at most once per depletion tier crossing. Writes `admin_alerts`. |
| `/api/cron/ad-fuel-ach-clear` | Hourly | Three-phase Stripe ACH reconciliation: (1) detect new ACH in-flight invoices → insert `ad_fuel_ach_pending`; (2) resolve pending entries as payments land → insert delta ledger credits; (3) delta-credit existing ledger entries when Stripe invoice amount_paid changes. |
| `/api/cron/ad-fuel-budget-alerts` | Daily 9 AM UTC | Forward-looking budget/runway alerts. Projects whether client will exhaust budget or balance before next billing date. Three path variants based on whether client has `bill_day` and `monthly_budget`. Uses AI (Haiku/gpt-4o-mini) for message text, falls back to template. Writes `admin_alerts`. |
| `/api/cron/auto-pause-ads` | 15 min past every hour | Pauses Google/Meta campaigns when Ad Fuel balance goes negative. Resumes when balance becomes positive and `auto_resume_ads = true`. Reads paused campaign IDs from last `ad_pause_log` row for targeted resume. Sends Discord alert on pause/resume. |
| `/api/cron/metric-alerts` | Daily 8 AM UTC | Two-phase alert: (1) day-over-day red alerts (default 50% threshold, spend ≥ $5); (2) 7v7 notable changes (default 25%, spend ≥ $10). Deduplicates by client+metric+platform+date. Sends email digest. Auto-dismisses stale daily alerts after 48h. |
| `/api/cron/cleanup-rejected-topics` | Mondays 9 AM UTC | Deletes `content_topics` rows where `status = 'rejected'` and `created_at < 7 days ago`. |
| `/api/cron/content-topics` | Daily 7 AM and 2 PM UTC (maxDuration 300s) | Full content pipeline: reset stuck generating topics; per-client topic generation; auto-approve dated/dateless topics; SEO brief generation; post generation; auto-push posts to WP/BC; BigCommerce spot-check alerts; service area page loop; batch email/Discord notifications. |
| `/api/admin/content/schedule` | Daily 6 AM UTC | (Separate from `content-topics`) Handles scheduled content delivery — the content calendar job. |
| `/api/cron/refresh-accounts` | Daily 4 AM UTC | Refreshes Google Ads OAuth tokens and re-runs `discoverAccounts` for all Google Ads connectors. Upserts results into `connector_accounts`. |
| `/api/cron/bc-daily-sales` | Daily 9 AM UTC | Sends BigCommerce yesterday + MTD revenue/order summary to Discord for clients with `bc_daily_report = true`. Computes date ranges in store's local timezone using `Intl.DateTimeFormat`. |

---

## Connector Types

| Type | Auth Method | Data Synced | Account Discovery |
|---|---|---|---|
| `google_ads` | OAuth 2.0 (`refresh_token`) | Campaign-level + ad-level + keywords + negatives + PMax assets. Daily. Also receives MCC push via `/api/ingest/google`. | `customer_client` GAQL on MCC, falls back to `listAccessibleCustomers`. |
| `meta_ads` | System User token or per-account OAuth 60-day token | Campaign-level + ad-level (with creative enrichment in 3 passes). Rate-limit retry. | `/me/adaccounts` with account_status. |
| `google_analytics` | Shared Google OAuth | Channel-group daily rows + source/medium/campaign rows (in `extraRows`). Web platform filter applied. | Admin API `accountSummaries`. `external_id` = `properties/XXXXX`. |
| `google_search_console` | Shared Google OAuth | GSC synced via `syncGSCInChunks` (NOT via `fetchMetrics` adapter — that is a stub). Hybrid 2D/3D approach in 30-day windows. | `/sites` endpoint. `external_id` = site URL. |
| `google_business_profile` | Shared Google OAuth | Daily location metrics (views, clicks, calls, directions) + review snapshot on most recent date. Rows cast via `unknown` due to type mismatch. | Account Mgmt API accounts + locations. `external_id` = `locations/XXXXX`. |
| `ghl` | API key | Daily CRM snapshots: contacts, calls (with direction), forms, surveys, bookings, opportunities, reviews. All 5 fetch types run in parallel. Backoff on 429. | `/locations/{locationId}`. |
| `wordpress` | Username + App Password | Write-only: `fetchMetrics` returns `{ rows: [] }`. Publishes posts/pages, manages tags, uploads media. | `/users/me`. |
| `ahrefs` | Bearer API key | Weekly domain authority snapshots + top keywords + top pages. DR history merged with metrics history by nearest date ±3 days. | Returns `[]` (no discovery). |
| `bigcommerce` | Store hash + Access token | Write-only for `fetchMetrics`: returns `{ rows: [] }`. BC orders fetched directly by `fetchBCOrders` for the daily sales cron. Publishes pages. | `/v2/store`. |

---

## Admin Pages

| URL | Purpose |
|---|---|
| `/admin` | Login page (two-step: password → TOTP/email code for super admin; email+password for regular admin) |
| `/admin/dashboard` | Clients overview table with per-client spend, conversions, Ad Fuel balance, sync status, efficiency score |
| `/admin/clients/new` | Create a new client |
| `/admin/clients/[id]` | Full client detail — 6 tabs: General, Integrations, Metrics, Content, Ad Fuel, Advanced |
| `/admin/clients/[id]/connections/new` | Assign a discovered connector account to the client |
| `/admin/clients/[id]/connections/[connectionId]` | Edit a specific client-connector assignment |
| `/admin/connections` | Agency-level connector management (all 9 types, OAuth status, Ahrefs + Stripe cards) |
| `/admin/connections/new` | Set up a new connector (OAuth redirect or credentials form) |
| `/admin/connections/[id]` | Edit connector auth/label/status; see clients using it |
| `/admin/ad-fuel` | Ad Fuel billing — Dashboard (balances, pace), Ledger (payments), Settings (billing config, cutoff date) |
| `/admin/content` | Global content calendar and global content settings |
| `/admin/alerts` | Admin notification center — all alert types with unread/dismiss |
| `/admin/settings` | Agency settings — 7 tabs: Branding, Benchmarks, Colors, AI, Sync, Notifications, Layouts |
| `/admin/users` | User list (super admin: edit/delete all; regular admin: view list only) |
| `/admin/users/new` | Create admin account (super admin only) |
| `/admin/users/[id]` | Edit user (super admin only) |
| `/admin/users/me` | Profile editor for the logged-in regular admin |
| `/admin/categories` | Campaign category taxonomy management |
| `/admin/system` | Ops page — Sync Logs tab + Activity Log tab; manual sync trigger; clear stuck jobs |
| `/admin/(preview)/preview` | Grid of all clients for quick dashboard preview selection |
| `/admin/preview/[clientId]` | Preview a client's dashboard (sets cookie, renders iframe) |

---

## Dashboard Pages

| URL | Metrics / Data Shown |
|---|---|
| `/dashboard` | Cockpit: KPI spark cards (spend, conversions, revenue, ROAS, CPA, CTR, etc.), daily performance chart, benchmarks panel, platform summary cards (Google Ads + Meta Ads), CRM activity, GA4/GSC/GBP/Ahrefs preview cards, Ad Fuel balance, Google Maps iframe |
| `/dashboard/google-ads` | Same as `/dashboard` but `source=google_ads` filter applied (Google campaigns only) |
| `/dashboard/meta-ads` | Same as `/dashboard` but `source=meta_ads` filter applied (Meta campaigns only) |
| `/dashboard/campaign/[campaignId]` | Campaign KPI spark cards, ad group/set breakdown table, keyword intelligence panel |
| `/dashboard/campaign/[campaignId]/adset/[adsetId]` | Ad group/set KPI spark cards, daily chart, ad-level view (PMax: asset gallery; Search: keywords + RSA copy + negatives; Meta/Display: ad creative table or cards) |
| `/dashboard/analytics` | GA4: Sessions, Users, New Users, Page Views, Conversions, session duration, engagement rate, traffic by channel, traffic by source/medium |
| `/dashboard/crm/ghl` | GoHighLevel: New Contacts, Forms, Opportunities, Won deals, call performance, form/survey breakdown, daily breakdown table |
| `/dashboard/seo/authority` | Ahrefs: Domain Rating, Backlinks, Referring Domains, Organic Traffic (sparklines), link velocity, keyword rankings table, top pages table |
| `/dashboard/seo/search-console` | GSC: Clicks, Impressions, CTR, Avg Position, position distribution, daily trend chart, top queries table, top pages table |
| `/dashboard/seo/gbp` | Google Business Profile: Total Views, Website Clicks, Calls, Directions, Reviews rating, views/clicks chart, location breakdown |
| `/dashboard/seo/maps` | Local Dominator Google Maps ranking iframe (full-screen) |

---

## API Routes by Feature Area

### Auth
- `GET /api/auth/access` — client portal entry (token → cookie → redirect)
- `POST /api/auth/admin-login` — two-step admin login
- `GET /api/auth/google/start` — initiate Google OAuth
- `GET /api/auth/google/callback` — Google OAuth callback, save tokens
- `GET /api/auth/meta/start` — initiate Meta OAuth
- `GET /api/auth/meta/callback` — Meta OAuth callback, save token
- `POST /api/auth/signout` — client portal sign-out
- `POST /api/auth/forgot-password` — password reset step 1 (email code)
- `POST /api/auth/reset-password` — password reset step 2 (verify + set new password)

### Admin Clients
- `GET POST /api/admin/clients` — list all clients / create client
- `PATCH DELETE /api/admin/clients/[id]` — update or delete client

### Admin Connectors
- `GET POST /api/admin/connectors` — list / create connector
- `PATCH DELETE /api/admin/connectors/[id]` — update / delete connector
- `POST /api/admin/connectors/[id]/discover` — re-run account discovery
- `POST /api/admin/connectors/[id]/test` — test Ahrefs connection

### Admin Connections
- `POST /api/admin/connections` — create client_connections row
- `PATCH DELETE /api/admin/connections/[id]` — update / delete connection
- `GET /api/admin/connections/[id]/test-ad-sync` — diagnostic ad-level sync test

### Ad Fuel
- `GET /api/admin/ad-fuel` — per-client balance dashboard rows
- `GET POST DELETE /api/admin/ad-fuel/ledger` — list, create, bulk-delete ledger entries
- `DELETE /api/admin/ad-fuel/ledger/[id]` — single delete
- `GET POST DELETE /api/admin/ad-fuel/pending-ach` — read pending totals / trigger Stripe scan / delete pending entry
- `POST /api/admin/ad-fuel/import` — CSV import of ledger entries
- `GET /api/adfuel` — public GHL sidebar widget endpoint (api-key auth)

### Sync
- `POST /api/admin/sync` — manual sync trigger (single client)
- `POST /api/admin/sync/all` — global historical sync (all clients)

### Settings / Users
- `GET PUT /api/admin/settings` — read / update agency settings
- `POST /api/admin/users` — create user (super admin)
- `PATCH DELETE /api/admin/users/[id]` — update / delete user
- `PATCH /api/admin/users/me` — update own profile

### Alerts
- `GET PATCH /api/admin/alerts` — list alerts / mark read
- `DELETE /api/admin/alerts/[id]` — dismiss alert
- `GET /api/admin/metric-alerts` — list metric-level alerts
- `POST /api/admin/metric-alerts/[id]/dismiss` — dismiss metric alert

### Content
- `GET POST /api/admin/content/topics` — list / create topics
- `GET /api/admin/content/posts` — list posts
- `POST /api/admin/content/generate` — generate a post from a topic
- `POST /api/admin/content/publish` — push post to WordPress
- `GET PUT /api/admin/content/global-settings` — global content settings
- `GET PUT /api/admin/content/client-settings` — per-client content/brand settings
- `POST /api/admin/content/generate-brand-dna` — AI brand analysis from URL
- `POST /api/admin/content/sitemap-parse` — crawl and parse a sitemap URL
- `GET PATCH /api/admin/content/sitemap-pages` — list / toggle sitemap page flags
- `POST /api/admin/content/topics/generate` — batch topic generation
- `DELETE /api/admin/content/topics/bulk-delete` — bulk delete topics
- `PATCH /api/admin/content/topics/[id]` — update topic status/date
- `DELETE /api/admin/content/topics/[id]` — delete single topic
- `POST /api/admin/content/topics/[id]/brief` — generate SEO brief for topic
- `POST /api/admin/content/posts/[id]/approve` — push post to WP/BC
- `POST /api/admin/content/regenerate` — AI re-edit a post
- `POST /api/admin/content/posts/[id]/generate-image` — AI image generation
- `POST /api/admin/content/posts/[id]/upload-image` — manual image upload

### Stripe
- `POST /api/admin/stripe/sync` — pull Stripe invoice history for a client
- `POST /api/webhooks/stripe` — Stripe webhook for `invoice.payment_succeeded`

### Export
- `GET /api/export/csv` — download metrics as CSV (client-facing)
- `GET /api/export/report` — HTML report (email or print/PDF format)

### Ingest (MCC push)
- `POST /api/ingest/google` — receive Google Ads campaign metrics pushed by an MCC script
- `POST /api/ingest/meta` — receive Meta Ads campaign metrics

### Utility
- `GET /api/settings/branding` — public; returns `agency_name` and `agency_logo_url`
- `POST /api/upload` — upload file to Supabase Storage (`uploads` bucket)
- `GET /api/proxy/meta-image` — proxy Meta ad creative images to avoid CORS issues

---

## External Service Integrations

| Service | Purpose | Auth |
|---|---|---|
| Supabase | Database + Storage | Service role key (server), anon key (browser) |
| Vercel | Hosting + Cron Jobs | CRON_SECRET bearer token |
| Google Ads API v23 | Campaign/ad metrics, account discovery | OAuth 2.0 + developer token + login-customer-id |
| Meta Graph API v21.0 | Campaign/ad metrics, account discovery | System User token or per-account OAuth token |
| Google Analytics Data API v1beta | GA4 traffic metrics | Shared Google OAuth |
| Google Search Console API v3 | Organic search metrics | Shared Google OAuth |
| Google Business Profile APIs | Local visibility metrics | Shared Google OAuth |
| Stripe API v2026-04-22.dahlia | Ad Fuel billing sync, ACH detection | Secret key from `agency_settings` |
| Mailgun (SMTP) | Transactional email | SMTP credentials in env vars |
| Discord REST API v10 | Ad Fuel balance alerts, content notifications | Bot token from `agency_settings` |
| OpenAI API | Content generation, image generation (DALL-E / gpt-image-1) | Key from `agency_settings.ai_api_key` or `openai_api_key` |
| Anthropic API | Content generation (Claude Haiku/Sonnet) | Key from `agency_settings.ai_api_key` |
| SerpAPI / Google Search | Competitor research for content topics | Key from `agency_settings.serp_api_key` |
| Ahrefs API | SEO domain authority, keywords, pages | API key stored in connector auth |
| GoHighLevel API | CRM data (contacts, calls, forms, opportunities) | API key stored in connector auth |
| WordPress REST API (wp/v2) | Content publishing, tag management, media upload | username + app_password in connector auth |
| BigCommerce API v2 | Order revenue (daily cron), page publishing | store_hash + access_token in connector auth |
| Gemini API | Fallback image generation | `GEMINI_API_KEY` env var |

---

## Key `lib/` Exports with Signatures

### `lib/metrics.ts`
```ts
summarizeMetrics(rows: MetricRow[]): MetricSummary
getDailyTrend(rows: MetricRow[]): DailyMetric[]
applyAdFuel(rawSpend: number, cutPct: number): number
calcDelta(current: number, prior: number): number | undefined
fmt$(n: number): string
fmtNum(n: number): string
fmtPct(n: number): string
fmtRoas(n: number): string
fmtCurrency(n: number): string
resolveMetaConversions(
  actions: MetaAction[],
  actionValues: MetaAction[],
  primaryAction: string,
  fallbackAction?: string
): { conversions: number; conversionValue: number }
```

### `lib/agency-settings.ts`
```ts
getAgencySettings(): Promise<AgencySettings>
calcEfficiencyScore(actual: {...}, benchmarks: {...}): number
pctOfBenchmark(actual: number, benchmark: number, inverted: boolean): number
scoreColor(score: number): string
DEFAULT_SETTINGS: AgencySettings
```

### `lib/auth.ts`
```ts
getAdminSession(): Promise<AdminSession | null>
isAdminAuthed(session: string | undefined): boolean
hashPassword(password: string): string
```

### `lib/supabase/server.ts`
```ts
createAdminClient(): SupabaseClient  // uses SUPABASE_SECRET_KEY
```

### `lib/supabase/client.ts`
```ts
createClient(): SupabaseClient  // uses NEXT_PUBLIC_SUPABASE_ANON_KEY (browser only)
```

### `lib/stripe.ts`
```ts
getStripeClient(): Promise<Stripe | null>
isAdFuelLine(line: Stripe.InvoiceLineItem): boolean
syncStripeInvoicesForClient(clientId: string, stripe: Stripe): Promise<number>
```

### `lib/connectors/registry.ts`
```ts
getConnectorDef(type: ConnectorType): ConnectorTypeDef
getConnectorAdapter(type: ConnectorType): ConnectorAdapter | null
isConnectorImplemented(type: ConnectorType): boolean
getConnectorEntry(type: ConnectorType): ConnectorRegistryEntry | null
ALL_CONNECTOR_TYPES: ConnectorType[]
GOOGLE_CONNECTOR_TYPES: ConnectorType[]
UNGROUPED_CONNECTOR_TYPES: ConnectorType[]
```

### `lib/connectors/sync.ts`
```ts
syncClient(
  clientId: string,
  jobType?: SyncJobType,
  days?: number,
  connectionId?: string,
  dateFrom?: string,
  dateTo?: string,
  triggeredBy?: 'cron' | 'admin' | 'system',
  excludeGsc?: boolean,
  connectorTypes?: string[]
): Promise<number>
BACKFILL_DAYS: 730
INCREMENTAL_DAYS: 7
```

### `lib/metric-layouts.ts`
```ts
resolveLayout(agencyLayouts, clientOverride, isEcom): MetricLayout
resolvePlatformLayout(agencyLayouts, clientOverride, platform): PlatformMetricLayout
resolveMetaMediaLayout(agencyLayouts, clientOverride, isEcom): PlatformMetricLayout
resolvePaidAdsLayout(agencyLayouts, clientOverride, isEcom): MetricLayout
```

### `lib/email.ts`
```ts
sendEmail({ to: string, subject: string, html: string, text?: string }): Promise<void>
```

### `lib/discord.ts`
```ts
sendDiscordMessage(botToken: string, channelId: string, content: string): Promise<void>
```

### `lib/activity.ts`
```ts
logActivity(
  session: AdminSession | null,
  action: string,
  resourceType: string,
  opts?: { resourceId?: string; clientId?: string; clientName?: string; meta?: Record<string, unknown> }
): void  // fire-and-forget
```

### `lib/apiError.ts`
```ts
class ApiError extends Error { statusCode: number }
parseBody<T>(request: Request): Promise<T | null>
errorResponse(err: unknown, fallback?: string): NextResponse
```
