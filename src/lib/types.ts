/** Per-client or global metric configuration. Client values override global defaults. */
export interface MetricConfig {
  /** Which Meta action_type to count as conversions. 'results' = Meta's campaign primary result. */
  meta_conversion_action?: string
  /** Display label override for the conversions metric, e.g. "Leads", "Purchases". */
  conversion_label?: string
  /**
   * Metric keys to hide on the client dashboard.
   * Valid keys: 'efficiency_score' | 'roas' | 'revenue' | 'conversions' |
   *             'cpl' | 'clicks' | 'ctr' | 'cpc' | 'impressions'
   */
  hidden_metrics?: string[]
}

export interface Client {
  id: string
  name: string
  email: string
  slug: string
  logo_url?: string
  dashboard_token: string
  benchmark_roas?: number | null
  benchmark_ctr?: number | null
  benchmark_cpc?: number | null
  benchmark_conv_rate?: number | null
  benchmark_cpm?: number | null
  metric_config: MetricConfig
  created_at: string
  updated_at: string
}

export interface AdAccount {
  id: string
  client_id: string | null
  platform: 'google' | 'meta'
  account_id: string
  account_name?: string
  access_token?: string
  refresh_token?: string
  token_expires_at?: string
  /** Discovered Meta action_type strings, accumulated during syncs. */
  available_meta_actions?: string[]
  created_at: string
}

export interface CampaignMetric {
  id: string
  client_id: string
  ad_account_id: string
  platform: 'google' | 'meta'
  campaign_id: string
  campaign_name: string
  date: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  conversion_value: number
  roas: number
  ctr: number
  cpc: number
  cpm: number
  /** Stored raw Meta action entries — used for live conversion remapping without re-sync.
   *  Each entry has count (value) and monetary value (revenue, from Meta action_values). */
  raw_meta_actions?: { action_type: string; value: string; revenue?: string }[] | null
}

export interface DateRange {
  from: Date
  to: Date
}

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
}

export interface DailyMetric {
  date: string
  spend: number
  conversions: number
  clicks: number
  roas: number
}

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

export interface AgencySettings {
  id: string
  agency_name: string
  agency_logo_url?: string
  benchmark_roas: number
  benchmark_ctr: number
  benchmark_cpc: number
  benchmark_conv_rate: number
  benchmark_cpm: number
  default_date_range_days: number
  meta_system_user_token?: string
  metric_config: MetricConfig
  updated_at: string
}

export interface MetricRow {
  campaign_id: string
  campaign_name: string
  date: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  conversion_value: number
  roas: number
  ctr: number
  cpc: number
  cpm: number
  /** Raw Meta action entries for post-hoc remapping. Only populated for Meta rows. */
  rawActions?: { action_type: string; value: string; revenue: string }[]
}

import type { GoalType } from './goal-types'
export type { GoalType }

export interface CampaignSettings {
  id: string
  client_id: string
  platform: 'google' | 'meta'
  campaign_id: string
  campaign_name: string
  goal_type: GoalType
  meta_conversion_action?: string | null
  conversion_label?: string | null
  hidden?: boolean
  created_at: string
  updated_at: string
}
