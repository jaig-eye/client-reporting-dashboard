// ─────────────────────────────────────────────────────────────────────────────
// Metric Layout System
//
// Defines the two configurable dashboard layouts (Ecom / Lead Gen).
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

export interface MetricLayout {
  kpi_cards:     MetricKey[]
  top_metrics:   MetricKey[]
  table_columns: ColumnKey[]
}

export interface MetricLayouts {
  lead_gen: MetricLayout
  ecom:     MetricLayout
}

// ── Human-readable labels for each key ───────────────────────────────────────

export const METRIC_LABELS: Record<MetricKey, string> = {
  spend:        'Total Cost',
  leads:        'Leads',
  conversions:  'Conversions',
  revenue:      'Revenue',
  roas:         'ROAS',
  cpa:          'CPA',
  ctr:          'CTR',
  conv_rate:    'Conv. Rate',
  cpm:          'CPM',
  cpc:          'Avg. CPC',
  impressions:  'Impressions',
  clicks:       'Clicks',
  reach:        'Reach',
  frequency:    'Frequency',
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

// ── Default layouts ───────────────────────────────────────────────────────────

export const DEFAULT_METRIC_LAYOUTS: MetricLayouts = {
  lead_gen: {
    kpi_cards:     ['spend', 'leads', 'cpa'],
    top_metrics:   ['impressions', 'clicks', 'ctr', 'conv_rate'],
    table_columns: ['campaign_name', 'status', 'spend', 'impressions', 'clicks', 'ctr', 'conversions', 'cpa', 'daily_budget'],
  },
  ecom: {
    kpi_cards:     ['spend', 'roas', 'revenue'],
    top_metrics:   ['conversions', 'ctr', 'cpc', 'conv_rate'],
    table_columns: ['campaign_name', 'status', 'spend', 'conversions', 'revenue', 'roas', 'cpa', 'ctr'],
  },
}

// ── All available metrics (for the layout editor UI) ─────────────────────────

export const ALL_METRIC_KEYS: MetricKey[] = [
  'spend', 'leads', 'conversions', 'revenue', 'roas', 'cpa',
  'ctr', 'conv_rate', 'cpm', 'cpc', 'impressions', 'clicks', 'reach', 'frequency',
]

export const ALL_COLUMN_KEYS: ColumnKey[] = [
  'campaign_name', 'status', 'spend', 'impressions', 'clicks',
  'ctr', 'conversions', 'conv_rate', 'cpa', 'roas', 'revenue', 'daily_budget',
]

// ── resolveLayout ─────────────────────────────────────────────────────────────

/**
 * Returns the active MetricLayout for a client dashboard.
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
