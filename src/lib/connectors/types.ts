// ─────────────────────────────────────────────────────────────────────────────
// Connector abstraction types
//
// A "connector" is a pluggable adapter for a data source. Each connector knows:
//   1. How to authenticate with the platform (OAuth, token, credentials)
//   2. How to discover available accounts (e.g. MCC → list of customer accounts)
//   3. How to fetch campaign metrics for a date range
//   4. How to validate an existing connection is still healthy
//
// Adding a new data source = implementing ConnectorAdapter and registering it.
// No other sync code needs to change.
// ─────────────────────────────────────────────────────────────────────────────

import type { ConnectorType, ConnectorTypeDef, MetaAction } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// RAW METRIC ROWS (source-faithful shapes returned from connector fetch calls)
// ─────────────────────────────────────────────────────────────────────────────

/** Raw Google Ads campaign metric row as returned by the connector. */
export interface GoogleAdsRawRow {
  campaign_id: string
  campaign_name: string
  campaign_status: string
  campaign_type: string
  date: string              // YYYY-MM-DD
  cost_micros: number
  daily_budget_micros: number  // campaign.campaign_budget.amount_micros
  impressions: number
  clicks: number
  conversions: number
  conversions_value: number
  all_conversions_value?: number
  view_through_conversions: number
  // Impression share — only available for Search campaigns; null for others
  search_impression_share?:         number | null
  search_abs_top_impression_share?: number | null
  search_top_impression_share?:     number | null
}

/** Raw Meta Ads campaign metric row as returned by the connector. */
export interface MetaAdsRawRow {
  campaign_id: string
  campaign_name: string
  objective: string
  campaign_status?: string  // ACTIVE | PAUSED | ARCHIVED | DELETED
  daily_budget?: number     // from Campaigns API (account currency)
  date: string              // YYYY-MM-DD
  spend: number
  impressions: number
  clicks: number
  reach: number
  frequency: number
  /** All action events from Meta API (used for live remapping). */
  actions: MetaAction[]
  action_values: MetaAction[]
}

/** Union of all source-specific raw row shapes. */
export type RawMetricRow = GoogleAdsRawRow | MetaAdsRawRow

/** Account discovery result: one entry per account visible in this connector. */
export interface DiscoveredAccount {
  external_id: string
  external_name: string
  metadata?: Record<string, unknown>
}

/** Result of a sync operation. */
export interface SyncResult {
  rows: RawMetricRow[]
  /** Action types encountered during this sync (Meta only) — accumulated in DB. */
  discoveredActions?: string[]
  /** Extra rows to upsert into non-standard tables, keyed by table name. */
  extraRows?: Record<string, unknown[]>
  error?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTOR ADAPTER INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every connector must implement this interface.
 * The sync engine calls these methods — it doesn't know which platform it's talking to.
 */
export interface ConnectorAdapter {
  readonly type: ConnectorType

  /**
   * Fetch campaign-level metrics for a specific account over a date range.
   *
   * @param externalId   - The platform-native account ID (e.g. Google Ads customer ID)
   * @param auth         - Connector auth object from the DB (tokens, credentials)
   * @param config       - Connector config object from the DB (MCC ID, BM ID, etc.)
   * @param dateFrom     - Start date (YYYY-MM-DD, inclusive)
   * @param dateTo       - End date (YYYY-MM-DD, inclusive)
   */
  fetchMetrics(
    externalId: string,
    auth: Record<string, unknown>,
    config: Record<string, unknown>,
    dateFrom: string,
    dateTo: string,
    onProgress?: (pct: number, note: string) => void
  ): Promise<SyncResult>

  /**
   * Discover all accounts accessible through this connector.
   * For example: list all Google Ads customer accounts under an MCC,
   * or all Meta ad accounts in a Business Manager.
   *
   * Returns an empty array if account discovery is not supported.
   */
  discoverAccounts(
    auth: Record<string, unknown>,
    config: Record<string, unknown>
  ): Promise<DiscoveredAccount[]>

  /**
   * Test whether the connector's auth credentials are still valid.
   * Returns true if the connection is healthy, false otherwise.
   * Should NOT throw — catch errors internally and return false.
   */
  testConnection(
    auth: Record<string, unknown>,
    config: Record<string, unknown>
  ): Promise<boolean>

  /**
   * Refresh OAuth tokens if they are expired or about to expire.
   * Returns updated auth object if tokens were refreshed, null if no refresh needed.
   * Called automatically by the sync engine before fetchMetrics.
   */
  refreshAuth?(
    auth: Record<string, unknown>
  ): Promise<Record<string, unknown> | null>
}

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTOR REGISTRY ENTRY
// ─────────────────────────────────────────────────────────────────────────────

/** Combines the UI metadata and the runtime adapter for a connector type. */
export interface ConnectorRegistryEntry {
  definition: ConnectorTypeDef
  adapter: ConnectorAdapter
}
