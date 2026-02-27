export interface Client {
  id: string
  name: string
  email: string
  slug: string
  logo_url?: string
  created_at: string
  updated_at: string
}

export interface AdAccount {
  id: string
  client_id: string
  platform: 'google' | 'meta'
  account_id: string
  account_name?: string
  token_expires_at?: string
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
}

export interface MetricDelta {
  current: MetricSummary
  prior: MetricSummary
  delta: {
    spend: number
    conversions: number
    roas: number
    clicks: number
  }
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
  platform: string
  status: 'running' | 'success' | 'error'
  records_synced: number
  error_message?: string
  started_at: string
  completed_at?: string
}
