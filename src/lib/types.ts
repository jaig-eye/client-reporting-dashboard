import type React from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Core domain types for the Client Reporting Dashboard
//
// Architecture overview:
//   Agency → Connectors (platform auth) → ClientConnections (account assignments)
//              ↓                                   ↓
//         ConnectorAccounts               Source-specific metrics tables
//         (discovered accounts)           (google_ads_metrics, meta_ads_metrics)
//
// Campaign taxonomy:
//   CampaignCategories (agency-defined) → ClientCampaignAssignments (per-client)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTOR TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** All supported data source types. Extend this union when adding new connectors. */
export type ConnectorType =
  | 'google_ads'
  | 'meta_ads'
  | 'google_analytics'
  | 'google_search_console'
  | 'google_business_profile'
  | 'ghl'
  | 'wordpress'
  | 'ahrefs'

/** Display metadata for each connector type — used in the UI. */
export interface ConnectorTypeDef {
  type: ConnectorType
  label: string
  description: string
  icon: string        // text fallback (single character)
  logo?: React.ComponentType<{ size?: number; className?: string }>  // branded SVG logo
  color: string       // Brand color hex
  authFlow: 'oauth' | 'token' | 'credentials'
}

/** Connection health status */
export type ConnectorStatus = 'active' | 'error' | 'disconnected' | 'pending'

/**
 * An agency-level authenticated connection to an external platform.
 * One connector can serve many clients (e.g. one Google MCC → many ad accounts).
 */
export interface Connector {
  id: string
  type: ConnectorType
  label: string
  status: ConnectorStatus
  /** OAuth tokens or API credentials — shape varies by connector type. */
  auth: Record<string, unknown>
  /** Connector-specific config (e.g. MCC customer ID, BM account ID). */
  config: Record<string, unknown>
  last_checked_at?: string
  created_at: string
  updated_at: string
}

/**
 * An account discovered within a connector (e.g. a Google Ads customer account
 * under an MCC, or a Meta ad account in a Business Manager).
 * Cached so the admin can assign accounts to clients without hitting the API.
 */
export interface ConnectorAccount {
  id: string
  connector_id: string
  external_id: string
  external_name?: string
  metadata: Record<string, unknown>
  is_linked: boolean
  created_at: string
  updated_at: string
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT CONNECTIONS
// ─────────────────────────────────────────────────────────────────────────────

export type ConnectionStatus = 'active' | 'paused' | 'error'

/**
 * Links a client to a specific account within a connector.
 * A client can have multiple connections (Google Ads + Meta + etc.).
 * Each connection has its own sync schedule and status.
 */
export interface ClientConnection {
  id: string
  client_id: string
  connector_id: string
  external_id: string         // Platform-native account ID
  external_name?: string
  status: ConnectionStatus
  last_synced_at?: string
  sync_from?: string          // ISO date string — start of historical sync window
  config: Record<string, unknown>
  created_at: string
  updated_at: string
  /** Populated via join when queried with connector details. */
  connector?: Connector
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENTS
// ─────────────────────────────────────────────────────────────────────────────

export interface Client {
  id: string
  name: string
  email: string
  slug: string
  logo_url?: string
  dashboard_token: string
  /** Client-level default conversion value (overrides agency default). */
  default_conversion_value?: number | null
  /**
   * Per-client Ad Fuel margin override (0.20 = 20%, 0 = pass-through).
   * NULL = use agency_settings.ad_fuel_cut.
   */
  ad_fuel_cut?: number | null
  /**
   * Meta conversion action override for Lead Gen campaigns.
   * NULL = use agency default_lead_action.
   */
  lead_action?: string | null
  /** Fallback action if primary lead action not found. NULL = use agency default. */
  lead_action_fallback?: string | null
  /**
   * Meta conversion action override for Ecommerce campaigns.
   * NULL = use agency default_purchase_action.
   */
  purchase_action?: string | null
  /** Fallback action if primary purchase action not found. NULL = use agency default. */
  purchase_action_fallback?: string | null
  /** Per-client benchmark overrides (null = use agency global). */
  benchmark_roas?:      number | null
  benchmark_ctr?:       number | null
  benchmark_cpc?:       number | null
  benchmark_conv_rate?: number | null
  benchmark_cpm?:       number | null
  benchmark_cpl?:       number | null
  /** When true, shows the Performance Benchmarks section on the client dashboard. */
  show_benchmarks?: boolean
  /**
   * Metric card IDs hidden from the client dashboard.
   * Valid IDs: spend, leads, cpl, roas, ctr, conv_rate, cpm, daily_chart, campaigns
   */
  hidden_metrics?: string[] | null
  /**
   * Which benchmark rows are shown in the benchmark panel and admin health cards.
   * NULL = not explicitly configured (ROAS only shown for ecom clients by legacy logic).
   * When set, only listed keys are shown. Valid keys: roas, ctr, cpc, conv_rate, cpm, cpl
   */
  enabled_benchmarks?: string[] | null
  /**
   * Per-client metric layout override. NULL = use agency_settings.metric_layouts.
   * Shape: { lead_gen: MetricLayout, ecom: MetricLayout }
   */
  metric_layout_override?: Record<string, unknown> | null
  /**
   * Explicit layout type override for this client.
   * 'lead_gen' | 'ecom' | null (null = auto-detect from campaign assignments)
   */
  layout_type?: string | null
  /** Billing cycle start day (1–31). Used for Ad Fuel cycle calculations. */
  bill_day?: number | null
  /** Historic billing day (1–31) before current bill_day was set. Adjusts lifetime spend start date to skip partial first period at agency cutoff. */
  historic_bill_day?: number | null
  /** Monthly ad spend budget in dollars. Used for Ad Fuel pace calculation. */
  monthly_budget?: number | null
  /** Discord channel ID for per-client notifications (requires agency discord_bot_token). */
  discord_channel_id?: string | null
  created_at: string
  updated_at: string
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENCY SETTINGS
// ─────────────────────────────────────────────────────────────────────────────

export interface AgencySettings {
  id: string
  agency_name: string
  agency_logo_url?: string
  /** Performance benchmark targets used in the Efficiency Score calculation. */
  benchmark_roas: number
  benchmark_ctr: number
  benchmark_cpc: number
  benchmark_conv_rate: number
  benchmark_cpm: number
  benchmark_cpl: number
  default_date_range_days: number
  /** Agency-wide default conversion value applied when no client/campaign override exists. */
  default_conversion_value: number
  /**
   * Global Ad Fuel margin (0.20 = 20% agency cut).
   * ad_fuel_spend = raw_spend / (1 - ad_fuel_cut)
   */
  ad_fuel_cut: number
  /** Default Meta conversion action type for lead-gen campaigns (e.g. 'onsite_conversion.lead_grouped'). */
  default_lead_action?: string
  /** Fallback action when primary lead action not found (e.g. 'lead'). */
  default_lead_action_fallback?: string
  /** Default Meta conversion action type for ecommerce campaigns (e.g. 'purchase'). */
  default_purchase_action?: string
  /** Fallback action when primary purchase action not found. */
  default_purchase_action_fallback?: string
  cron_enabled: boolean
  app_version: string
  primary_user_id?: string
  updated_at: string
  /** Chart series colors — all are CSS hex strings. */
  chart_color_spend?:             string
  chart_color_prior_spend?:       string
  chart_color_conversions?:       string
  chart_color_prior_conversions?: string
  /** AI model configuration for content generation and insights. */
  ai_provider?: string
  ai_model?: string
  ai_api_key?: string
  /**
   * Agency-wide default metric layouts for Ecom and Lead Gen dashboards.
   * NULL = use DEFAULT_METRIC_LAYOUTS from src/lib/metric-layouts.ts.
   * Shape: { lead_gen: MetricLayout, ecom: MetricLayout }
   */
  metric_layouts?: Record<string, unknown> | null
  /** Connector types globally hidden from all client dashboards (e.g. 'google_analytics', 'google_search_console', 'ahrefs'). */
  hidden_connector_types?: string[]
  /** Discord bot token for sending per-client notifications to Discord channels. */
  discord_bot_token?: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-SPECIFIC METRICS
// ─────────────────────────────────────────────────────────────────────────────

/** Google Ads campaign metrics (one row per campaign per day per account connection). */
export interface GoogleAdsMetric {
  id: string
  connection_id: string
  client_id: string
  campaign_id: string
  campaign_name: string
  campaign_status?: string    // ENABLED | PAUSED | REMOVED
  campaign_type?: string      // SEARCH | DISPLAY | SHOPPING | VIDEO | etc.
  date: string                // YYYY-MM-DD
  // Spend
  cost_micros: number         // Native Google unit (÷ 1,000,000 = dollars)
  spend: number               // cost_micros / 1,000,000
  // Reach
  impressions: number
  clicks: number
  // Conversions
  conversions: number
  conversions_value: number
  view_through_conversions: number
  // Derived
  roas: number
  ctr: number
  cpc: number
  cpm: number
}

/**
 * Meta Ads campaign metrics (one row per campaign per day per account connection).
 * Actions and action_values store all conversion events as JSONB for live remapping.
 */
export interface MetaAdsMetric {
  id: string
  connection_id: string
  client_id: string
  campaign_id: string
  campaign_name: string
  objective?: string          // Meta native: LEAD_GENERATION, CONVERSIONS, etc.
  date: string                // YYYY-MM-DD
  spend: number
  impressions: number
  clicks: number
  reach: number
  frequency: number
  /** All conversion event counts: [{ action_type: string, value: string }] */
  actions: MetaAction[]
  /** Conversion revenue by action type: [{ action_type: string, value: string }] */
  action_values: MetaAction[]
  // Derived (computed from primary result action at ingest, remappable at query time)
  conversions: number
  conversion_value: number
  roas: number
  ctr: number
  cpc: number
  cpm: number
  /** Accumulated list of all action_type strings seen for this campaign. */
  discovered_actions: string[]
}

export interface MetaAction {
  action_type: string
  value: string
}

/** GoHighLevel CRM metrics (daily CRM activity snapshot per location). */
export interface GhlMetric {
  id: string
  connection_id: string
  client_id: string
  date: string
  contacts_created: number
  total_calls: number
  missed_calls: number
  forms_submitted: number
  reviews_sent: number
  reviews_received: number
  spam_leads: number
  emails_sent: number
  sms_sent: number
  raw_data?: Record<string, unknown>
  synced_at: string
}

/** GA4 website traffic metrics (daily). */
export interface Ga4Metric {
  id: string
  connection_id: string
  client_id: string
  date: string
  sessions: number
  users: number
  new_users: number
  page_views: number
  bounce_rate: number
  avg_session_duration: number
  conversions: number
  raw_data?: Record<string, unknown>
  synced_at: string
}

// ─────────────────────────────────────────────────────────────────────────────
// CAMPAIGN CATEGORIES
// ─────────────────────────────────────────────────────────────────────────────

/** Controls which metrics are highlighted in the dashboard for campaigns in this category. */
export type CategoryDisplayMode =
  | 'lead_gen'    // Show CPL, conversion count — no ROAS
  | 'ecommerce'   // Show ROAS, revenue, purchases
  | 'awareness'   // Show impressions, CPM, reach, frequency
  | 'engagement'  // Show clicks, CTR, engagement rate
  | 'custom'      // No special emphasis — show all standard metrics

/**
 * Agency-defined campaign category. Reusable across all clients.
 * Admins create categories that match their service offerings.
 */
export interface CampaignCategory {
  id: string
  name: string
  color: string                     // Hex color for UI badges
  description?: string
  display_mode: CategoryDisplayMode
  default_conversion_value: number  // Agency-wide default for this category
  conversion_label: string          // e.g. "Leads", "Purchases", "Phone Calls"
  is_default: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

/**
 * Per-campaign configuration for a specific client.
 * Campaigns are auto-discovered during sync and inserted with category_id = null.
 * Admins then assign categories and optionally override conversion logic.
 */
export interface ClientCampaignAssignment {
  id: string
  client_id: string
  source: ConnectorType           // Which data source this campaign comes from
  campaign_id: string
  campaign_name: string
  category_id?: string | null
  conversion_value_override?: number | null   // Overrides category + agency default
  meta_conversion_action?: string | null      // Meta-specific: which action counts
  /**
   * Per-campaign display mode — controls which metrics are highlighted.
   * 'lead_gen' → CPL, conversion count. 'ecommerce' → ROAS, revenue.
   * Replaces the indirect category → display_mode relationship.
   */
  display_mode: string                        // 'lead_gen' | 'ecommerce' | ...
  /** Human-readable label for the conversion metric (e.g. "Leads", "Purchases"). */
  conversion_label?: string | null
  hidden: boolean
  notes?: string
  created_at: string
  updated_at: string
  /** Populated via join. */
  category?: CampaignCategory
}

// ─────────────────────────────────────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'viewer'

export interface User {
  id: string
  name: string
  email: string
  avatar_url?: string
  role: UserRole
  is_active: boolean
  last_login_at?: string
  created_at: string
  updated_at: string
  /** password_hash is never returned to the client — omitted from SELECT queries */
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNC JOBS
// ─────────────────────────────────────────────────────────────────────────────

export type SyncJobType = 'backfill' | 'incremental' | 'manual'
export type SyncJobStatus = 'running' | 'success' | 'error'

export interface SyncJob {
  id: string
  connection_id: string
  client_id: string
  job_type: SyncJobType
  status: SyncJobStatus
  records_synced: number
  error_message?: string
  date_from?: string
  date_to?: string
  started_at: string
  completed_at?: string
  /** Populated via join. */
  connection?: ClientConnection
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD / REPORTING TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface DateRange {
  from: Date
  to: Date
}

/** Aggregated metric summary for a date range (used by dashboard KPI cards). */
export interface MetricSummary {
  spend: number
  impressions: number
  clicks: number
  conversions: number
  conversionValue: number
  roas: number
  ctr: number
  cpc: number
  cpl: number
  cpm: number
  /** Ad Fuel spend = raw spend / (1 - ad_fuel_cut). Set on the dashboard with client's cut. */
  adFuelSpend?: number
  reach?: number              // Meta-only
  frequency?: number          // Meta-only
}

/** Daily data point for the trend chart. */
export interface DailyMetric {
  date: string
  spend: number
  conversions: number
  clicks: number
  roas: number
}

/**
 * Enriched campaign row used in the campaign breakdown table.
 * Built at query time by joining metrics with category assignments.
 */
export interface CampaignRow {
  campaign_id: string
  campaign_name: string
  source: ConnectorType
  spend: number
  impressions: number
  clicks: number
  conversions: number
  conversionValue: number
  roas: number
  cpl: number
  ctr: number
  cpm: number
  /** Ad Fuel spend (marked-up) — computed from spend + client's ad_fuel_cut. */
  adFuelSpend?: number
  /** Display mode determines which metrics are highlighted. */
  display_mode?: string | null
  hidden: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// AD-LEVEL METRICS (for campaign drill-down)
// ─────────────────────────────────────────────────────────────────────────────

/** Google Ads ad-level metric row (one row per ad per day). */
export interface GoogleAdsAdMetric {
  id: string
  connection_id: string
  client_id: string
  campaign_id: string
  campaign_name: string
  ad_group_id: string
  ad_group_name: string
  ad_id: string
  ad_name: string
  ad_type?: string
  date: string
  cost_micros: number
  spend: number
  impressions: number
  clicks: number
  conversions: number
  conversions_value: number
}

/** Meta Ads ad-level metric row (one row per ad per day). */
export interface MetaAdsAdMetric {
  id: string
  connection_id: string
  client_id: string
  campaign_id: string
  campaign_name: string
  adset_id?: string
  adset_name?: string
  ad_id: string
  ad_name: string
  thumbnail_url?: string
  date: string
  spend: number
  impressions: number
  clicks: number
  reach: number
  actions: MetaAction[]
  action_values: MetaAction[]
  conversions: number
  conversion_value: number
}

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY COMPATIBILITY (kept for gradual migration, remove after full cutover)
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated Use ClientConnection instead */
export interface AdAccount {
  id: string
  client_id: string | null
  platform: 'google' | 'meta'
  account_id: string
  account_name?: string
  access_token?: string
  refresh_token?: string
  token_expires_at?: string
  available_meta_actions?: string[]
  created_at: string
}

/** @deprecated Use SyncJob instead */
export interface SyncLog {
  id: string
  client_id: string
  platform: string
  status: 'running' | 'success' | 'error'
  records_synced: number
  error_message?: string
  started_at: string
  completed_at?: string
}
