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

/** Display metadata for each connector type — used in the UI. */
export interface ConnectorTypeDef {
  type: ConnectorType
  label: string
  description: string
  icon: string        // SVG path or emoji fallback
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
  default_date_range_days: number
  /** Agency-wide default conversion value applied when no client/campaign override exists. */
  default_conversion_value: number
  cron_enabled: boolean
  app_version: string
  primary_user_id?: string
  updated_at: string
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
  category?: CampaignCategory
  hidden: boolean
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
