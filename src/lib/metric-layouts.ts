// ─────────────────────────────────────────────────────────────────────────────
// Metric Layout System
//
// Defines the configurable dashboard layouts.
// Each layout has three sections:
//   kpi_cards     — metrics shown with sparklines (large, top row)
//   top_metrics   — metrics shown without sparklines (smaller, second row)
//   table_columns — campaign table columns in display order
//
// Defaults are stored in agency_settings.metric_layouts.
// Per-client overrides live in clients.metric_layout_override.
// resolveLayout() merges them with fallback to DEFAULT_METRIC_LAYOUTS.
// ─────────────────────────────────────────────────────────────────────────────

export type MetricKey =
  | 'spend'
  | 'leads'
  | 'conversions'
  | 'revenue'
  | 'roas'
  | 'cpa'
  | 'ctr'
  | 'conv_rate'
  | 'cpm'
  | 'cpc'
  | 'impressions'
  | 'clicks'
  | 'reach'
  | 'frequency'
  // Search-specific
  | 'impression_share'
  // Meta awareness/media
  | 'video_views'
  | 'video_view_rate'
  | 'thruplay'

export type PlatformCardKey =
  | 'spend'
  | 'conversions'
  | 'ctr'
  | 'impressions'
  | 'clicks'
  | 'cpa'
  | 'roas'
  | 'cpm'
  | 'cpc'
  | 'revenue'
  | 'reach'
  | 'frequency'

export type ColumnKey =
  | 'campaign_name'
  | 'status'
  | 'spend'
  | 'impressions'
  | 'clicks'
  | 'ctr'
  | 'conversions'
  | 'conv_rate'
  | 'cpa'
  | 'roas'
  | 'revenue'
  | 'daily_budget'

export type AdGroupColumnKey =
  | 'spend'
  | 'impressions'
  | 'clicks'
  | 'ctr'
  | 'cpc'
  | 'cpm'
  | 'conversions'
  | 'conv_rate'
  | 'cpa'
  | 'roas'
  | 'revenue'
  | 'ad_count'

export type AdColumnKey =
  | 'spend'
  | 'impressions'
  | 'clicks'
  | 'ctr'
  | 'conversions'
  | 'conv_rate'
  | 'cpa'

export interface MetricLayout {
  kpi_cards:     MetricKey[]
  top_metrics:   MetricKey[]
  table_columns: ColumnKey[]
  // Optional: which metrics to show in the platform summary cards on the dashboard
  platform_google_metrics?: PlatformCardKey[]
  platform_meta_metrics?:   PlatformCardKey[]
}

// Platform-specific campaign pages use string[] to allow platform-native metric names
export interface PlatformMetricLayout {
  kpi_cards:              string[]
  top_metrics:            string[]
  table_columns:          string[]
  adgroup_table_columns?: string[]
  ads_table_columns?:     string[]
}

export interface MetricLayouts {
  // Summary page (lead gen / ecom — existing, backward compatible)
  lead_gen: MetricLayout
  ecom:     MetricLayout
  // Paid ads campaign/adset pages
  paid_ads_lead_gen?: MetricLayout
  paid_ads_ecom?:     MetricLayout
  // Platform-specific campaign views
  google_search?:   PlatformMetricLayout
  google_shopping?: PlatformMetricLayout
  meta_media?:      PlatformMetricLayout
  // Meta media split by conversion type
  meta_media_lead_gen?: PlatformMetricLayout
  meta_media_ecom?:     PlatformMetricLayout
}

// ── Human-readable labels for each key ───────────────────────────────────────

export const METRIC_LABELS: Record<MetricKey, string> = {
  spend:            'Total Cost',
  leads:            'Leads',
  conversions:      'Conversions',
  revenue:          'Revenue',
  roas:             'ROAS',
  cpa:              'CPA',
  ctr:              'CTR',
  conv_rate:        'Conv. Rate',
  cpm:              'CPM',
  cpc:              'Avg. CPC',
  impressions:      'Impressions',
  clicks:           'Clicks',
  reach:            'Reach',
  frequency:        'Frequency',
  impression_share: 'Impression Share',
  video_views:      'Video Views',
  video_view_rate:  'Video View Rate',
  thruplay:         'ThruPlay',
}

export const PLATFORM_CARD_LABELS: Record<PlatformCardKey, string> = {
  spend:       'Total Cost',
  conversions: 'Conversions',
  ctr:         'CTR',
  impressions: 'Impressions',
  clicks:      'Clicks',
  cpa:         'CPA',
  roas:        'ROAS',
  cpm:         'CPM',
  cpc:         'Avg. CPC',
  revenue:     'Revenue',
  reach:       'Reach',
  frequency:   'Frequency',
}

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  campaign_name: 'Campaign',
  status:        'Status',
  spend:         'Cost',
  impressions:   'Impressions',
  clicks:        'Clicks',
  ctr:           'CTR',
  conversions:   'Conversions',
  conv_rate:     'Conv. Rate',
  cpa:           'CPA',
  roas:          'ROAS',
  revenue:       'Revenue',
  daily_budget:  'Daily Budget',
}

export const ADGROUP_COLUMN_LABELS: Record<AdGroupColumnKey, string> = {
  spend:       'Cost',
  impressions: 'Impressions',
  clicks:      'Clicks',
  ctr:         'CTR',
  cpc:         'Avg. CPC',
  cpm:         'CPM',
  conversions: 'Conversions',
  conv_rate:   'Conv. Rate',
  cpa:         'CPA',
  roas:        'ROAS',
  revenue:     'Revenue',
  ad_count:    'Ads',
}

export const AD_COLUMN_LABELS: Record<AdColumnKey, string> = {
  spend:       'Cost',
  impressions: 'Impressions',
  clicks:      'Clicks',
  ctr:         'CTR',
  conversions: 'Conversions',
  conv_rate:   'Conv. Rate',
  cpa:         'CPA',
}

// ── Default layouts ───────────────────────────────────────────────────────────

export const DEFAULT_METRIC_LAYOUTS: MetricLayouts = {
  lead_gen: {
    kpi_cards:              ['spend', 'conversions', 'cpa'],
    top_metrics:            ['impressions', 'clicks', 'ctr', 'conv_rate'],
    table_columns:          ['campaign_name', 'status', 'spend', 'impressions', 'clicks', 'ctr', 'conversions', 'cpa', 'daily_budget'],
    platform_google_metrics: ['spend', 'conversions', 'ctr'],
    platform_meta_metrics:   ['spend', 'conversions', 'ctr'],
  },
  ecom: {
    kpi_cards:              ['spend', 'roas', 'revenue'],
    top_metrics:            ['conversions', 'ctr', 'cpc', 'conv_rate'],
    table_columns:          ['campaign_name', 'status', 'spend', 'conversions', 'revenue', 'roas', 'cpa', 'ctr'],
    platform_google_metrics: ['spend', 'revenue', 'roas'],
    platform_meta_metrics:   ['spend', 'revenue', 'roas'],
  },
}

export const DEFAULT_PAID_ADS_LEAD_GEN: MetricLayout = {
  kpi_cards:              ['spend', 'conversions', 'cpa', 'ctr'],
  top_metrics:            ['clicks', 'impressions', 'cpm', 'cpc'],
  table_columns:          ['campaign_name', 'status', 'spend', 'impressions', 'clicks', 'ctr', 'conversions', 'cpa'],
  platform_google_metrics: ['spend', 'conversions', 'ctr'],
  platform_meta_metrics:   ['spend', 'impressions', 'ctr'],
}

export const DEFAULT_PAID_ADS_ECOM: MetricLayout = {
  kpi_cards:              ['spend', 'revenue', 'roas', 'ctr'],
  top_metrics:            ['clicks', 'impressions', 'conversions', 'cpa'],
  table_columns:          ['campaign_name', 'status', 'spend', 'revenue', 'roas', 'conversions', 'cpa'],
  platform_google_metrics: ['spend', 'revenue', 'roas'],
  platform_meta_metrics:   ['spend', 'revenue', 'roas'],
}

export const DEFAULT_GOOGLE_SEARCH_LAYOUT: PlatformMetricLayout = {
  kpi_cards:             ['spend', 'conversions', 'impression_share', 'ctr'],
  top_metrics:           ['clicks', 'impressions', 'cpc', 'conv_rate'],
  table_columns:         ['campaign_name', 'status', 'spend', 'impressions', 'clicks', 'ctr', 'conversions', 'cpa'],
  adgroup_table_columns: ['spend', 'impressions', 'clicks', 'ctr', 'conversions', 'conv_rate', 'cpa'],
  ads_table_columns:     ['spend', 'impressions', 'clicks', 'ctr', 'conversions', 'conv_rate', 'cpa'],
}

export const DEFAULT_GOOGLE_SHOPPING_LAYOUT: PlatformMetricLayout = {
  kpi_cards:             ['spend', 'revenue', 'roas', 'conversions'],
  top_metrics:           ['clicks', 'impressions', 'ctr', 'cpa'],
  table_columns:         ['campaign_name', 'status', 'spend', 'revenue', 'roas', 'conversions', 'cpa'],
  adgroup_table_columns: ['spend', 'impressions', 'clicks', 'ctr', 'conversions', 'roas', 'revenue'],
  ads_table_columns:     ['spend', 'impressions', 'clicks', 'ctr', 'conversions', 'conv_rate', 'cpa'],
}

export const DEFAULT_META_MEDIA_LAYOUT: PlatformMetricLayout = {
  kpi_cards:             ['spend', 'reach', 'frequency', 'cpm'],
  top_metrics:           ['impressions', 'clicks', 'ctr', 'video_views'],
  table_columns:         ['campaign_name', 'status', 'spend', 'reach', 'frequency', 'cpm', 'impressions'],
  adgroup_table_columns: ['spend', 'impressions', 'clicks', 'ctr', 'conversions', 'conv_rate', 'cpa'],
  ads_table_columns:     ['spend', 'impressions', 'clicks', 'ctr', 'conversions', 'conv_rate', 'cpa'],
}

export const DEFAULT_META_MEDIA_LEAD_GEN: PlatformMetricLayout = {
  kpi_cards:             ['spend', 'reach', 'frequency', 'cpm'],
  top_metrics:           ['impressions', 'clicks', 'ctr', 'video_views'],
  table_columns:         ['campaign_name', 'status', 'spend', 'reach', 'frequency', 'cpm', 'impressions'],
  adgroup_table_columns: ['spend', 'impressions', 'clicks', 'ctr', 'conversions', 'conv_rate', 'cpa'],
  ads_table_columns:     ['spend', 'impressions', 'clicks', 'ctr', 'conversions', 'conv_rate', 'cpa'],
}

export const DEFAULT_META_MEDIA_ECOM: PlatformMetricLayout = {
  kpi_cards:             ['spend', 'reach', 'frequency', 'roas'],
  top_metrics:           ['impressions', 'clicks', 'ctr', 'video_views'],
  table_columns:         ['campaign_name', 'status', 'spend', 'reach', 'frequency', 'revenue', 'roas'],
  adgroup_table_columns: ['spend', 'impressions', 'clicks', 'ctr', 'conversions', 'conv_rate', 'roas', 'revenue'],
  ads_table_columns:     ['spend', 'impressions', 'clicks', 'ctr', 'conversions', 'conv_rate', 'cpa'],
}

// ── All available metrics (for the layout editor UI) ─────────────────────────

export const ALL_METRIC_KEYS: MetricKey[] = [
  'spend', 'leads', 'conversions', 'revenue', 'roas', 'cpa',
  'ctr', 'conv_rate', 'cpm', 'cpc', 'impressions', 'clicks', 'reach', 'frequency',
  'impression_share', 'video_views', 'video_view_rate', 'thruplay',
]

// Keys that have metricValMap entries on the dashboard page — safe to use in
// Summary Page and Paid Ads layout tabs. The newer platform-specific keys
// (impression_share, video_views, etc.) only apply to their dedicated tabs.
export const DASHBOARD_METRIC_KEYS: MetricKey[] = [
  'spend', 'leads', 'conversions', 'revenue', 'roas', 'cpa',
  'ctr', 'conv_rate', 'cpm', 'cpc', 'impressions', 'clicks', 'reach', 'frequency',
]

export const ALL_PLATFORM_CARD_KEYS: PlatformCardKey[] = [
  'spend', 'conversions', 'ctr', 'impressions', 'clicks',
  'cpa', 'roas', 'cpm', 'cpc', 'revenue', 'reach', 'frequency',
]

export const ALL_COLUMN_KEYS: ColumnKey[] = [
  'campaign_name', 'status', 'spend', 'impressions', 'clicks',
  'ctr', 'conversions', 'conv_rate', 'cpa', 'roas', 'revenue', 'daily_budget',
]

export const ALL_ADGROUP_COLUMN_KEYS: AdGroupColumnKey[] = [
  'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm',
  'conversions', 'conv_rate', 'cpa', 'roas', 'revenue', 'ad_count',
]

export const ALL_AD_COLUMN_KEYS: AdColumnKey[] = [
  'spend', 'impressions', 'clicks', 'ctr', 'conversions', 'conv_rate', 'cpa',
]

// Metric keys available per platform context (for editor dropdowns)
export const SEARCH_ADS_METRIC_KEYS: MetricKey[] = [
  'spend', 'conversions', 'cpa', 'ctr', 'conv_rate', 'cpm', 'cpc',
  'impressions', 'clicks', 'impression_share',
]

export const SHOPPING_METRIC_KEYS: MetricKey[] = [
  'spend', 'revenue', 'roas', 'conversions', 'cpa', 'ctr',
  'cpc', 'impressions', 'clicks',
]

export const META_MEDIA_METRIC_KEYS: MetricKey[] = [
  'spend', 'reach', 'frequency', 'cpm', 'impressions', 'clicks', 'ctr',
  'video_views', 'video_view_rate', 'thruplay',
]

// ── resolveLayout ─────────────────────────────────────────────────────────────

/**
 * Returns the active MetricLayout for a client dashboard (summary page).
 * Priority: client override → agency settings → built-in defaults.
 */
export function resolveLayout(
  agencyLayouts: MetricLayouts | null | undefined,
  clientOverride: MetricLayouts | null | undefined,
  isEcom: boolean
): MetricLayout {
  const layouts = clientOverride ?? agencyLayouts ?? DEFAULT_METRIC_LAYOUTS
  return isEcom ? layouts.ecom : layouts.lead_gen
}

/**
 * Returns the active PlatformMetricLayout for a specific platform context.
 * Falls back through client override → agency settings → built-in defaults.
 */
export function resolvePlatformLayout(
  agencyLayouts: MetricLayouts | null | undefined,
  clientOverride: MetricLayouts | null | undefined,
  platform: 'google_search' | 'google_shopping' | 'meta_media'
): PlatformMetricLayout {
  const defaults: Record<typeof platform, PlatformMetricLayout> = {
    google_search:   DEFAULT_GOOGLE_SEARCH_LAYOUT,
    google_shopping: DEFAULT_GOOGLE_SHOPPING_LAYOUT,
    meta_media:      DEFAULT_META_MEDIA_LAYOUT,
  }
  return (
    clientOverride?.[platform] ??
    agencyLayouts?.[platform]  ??
    defaults[platform]
  )
}

/**
 * Returns the active PlatformMetricLayout for Meta Media, split by lead gen vs ecom.
 * Falls back through client override → agency settings → built-in defaults.
 */
export function resolveMetaMediaLayout(
  agencyLayouts: MetricLayouts | null | undefined,
  clientOverride: MetricLayouts | null | undefined,
  isEcom: boolean,
): PlatformMetricLayout {
  const key = isEcom ? 'meta_media_ecom' : 'meta_media_lead_gen'
  const def = isEcom ? DEFAULT_META_MEDIA_ECOM : DEFAULT_META_MEDIA_LEAD_GEN
  return clientOverride?.[key] ?? agencyLayouts?.[key] ?? def
}

/**
 * Returns the active paid-ads MetricLayout for campaign/adset pages.
 */
export function resolvePaidAdsLayout(
  agencyLayouts: MetricLayouts | null | undefined,
  clientOverride: MetricLayouts | null | undefined,
  isEcom: boolean
): MetricLayout {
  if (isEcom) {
    return (
      clientOverride?.paid_ads_ecom ??
      agencyLayouts?.paid_ads_ecom  ??
      DEFAULT_PAID_ADS_ECOM
    )
  }
  return (
    clientOverride?.paid_ads_lead_gen ??
    agencyLayouts?.paid_ads_lead_gen  ??
    DEFAULT_PAID_ADS_LEAD_GEN
  )
}
