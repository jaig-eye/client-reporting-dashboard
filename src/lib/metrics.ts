import type { MetricSummary, DailyMetric, MetaAction } from './types'

interface MetricRow {
  spend: number
  impressions: number
  clicks: number
  conversions: number
  conversion_value: number
  reach?: number
  frequency?: number
  date?: string
}

export function summarizeMetrics(rows: MetricRow[]): MetricSummary {
  const spend           = rows.reduce((s, r) => s + Number(r.spend), 0)
  const impressions     = rows.reduce((s, r) => s + Number(r.impressions), 0)
  const clicks          = rows.reduce((s, r) => s + Number(r.clicks), 0)
  const conversions     = rows.reduce((s, r) => s + Number(r.conversions), 0)
  const conversionValue = rows.reduce((s, r) => s + Number(r.conversion_value), 0)

  // Reach: sum (unique reach is already deduplicated per day by Meta)
  const reach = rows.reduce((s, r) => s + Number(r.reach ?? 0), 0)

  // Frequency: impressions-weighted average across rows
  const freqImprTotal = rows.reduce((s, r) => s + Number(r.impressions), 0)
  const freqWeighted  = rows.reduce((s, r) => {
    const imp  = Number(r.impressions)
    const freq = Number(r.frequency ?? 0)
    return s + freq * imp
  }, 0)
  const frequency = freqImprTotal > 0 ? freqWeighted / freqImprTotal : 0

  return {
    spend,
    impressions,
    clicks,
    conversions,
    conversionValue,
    roas:      spend > 0 ? conversionValue / spend : 0,
    ctr:       impressions > 0 ? clicks / impressions : 0,
    cpc:       clicks > 0 ? spend / clicks : 0,
    cpl:       conversions > 0 ? spend / conversions : 0,
    cpm:       impressions > 0 ? (spend / impressions) * 1000 : 0,
    reach,
    frequency,
  }
}

export function getDailyTrend(rows: MetricRow[]): DailyMetric[] {
  const byDate: Record<string, { spend: number; conversions: number; clicks: number; conversionValue: number }> = {}

  for (const row of rows) {
    const date = String(row.date ?? '').split('T')[0]
    if (!date) continue
    if (!byDate[date]) byDate[date] = { spend: 0, conversions: 0, clicks: 0, conversionValue: 0 }
    byDate[date].spend           += Number(row.spend)
    byDate[date].conversions     += Number(row.conversions)
    byDate[date].clicks          += Number(row.clicks)
    byDate[date].conversionValue += Number(row.conversion_value)
  }

  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      spend:       d.spend,
      conversions: d.conversions,
      clicks:      d.clicks,
      roas:        d.spend > 0 ? d.conversionValue / d.spend : 0,
    }))
}

/**
 * Compute Ad Fuel spend from raw platform spend and the agency's cut percentage.
 *
 * The agency retains `cutPct` of the total billed amount ("Ad Fuel"); the rest
 * goes to the platform as raw ad spend.
 *
 *   ad_fuel_spend = raw_spend / (1 - cut_pct)
 *
 * Examples:
 *   $800 raw, 20% cut → $1,000 Ad Fuel ($200 kept by agency)
 *   $800 raw,  0% cut → $800 Ad Fuel (client gets 100% on ads)
 */
export function applyAdFuel(rawSpend: number, cutPct: number): number {
  if (cutPct <= 0) return rawSpend
  if (cutPct >= 1) return rawSpend // guard against invalid config
  return rawSpend / (1 - cutPct)
}

export function calcDelta(current: number, prior: number): number | undefined {
  if (prior === 0) return undefined
  return ((current - prior) / Math.abs(prior)) * 100
}

export function fmt$(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

export function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return new Intl.NumberFormat('en-US').format(Math.round(n))
}

export function fmtPct(n: number): string {
  return `${(n * 100).toFixed(2)}%`
}

export function fmtRoas(n: number): string {
  return `${n.toFixed(2)}x`
}

export function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

/**
 * Resolve Meta conversion count using primary action, falling back to secondary.
 * Tries primaryAction first; if no conversions found, tries fallbackAction.
 */
export function resolveMetaConversions(
  actions: MetaAction[] | null | undefined,
  actionValues: MetaAction[] | null | undefined,
  primaryAction: string,
  fallbackAction?: string | null,
): { conversions: number; conversionValue: number } {
  const acts    = actions      ?? []
  const actVals = actionValues ?? []

  function getVal(type: string) {
    const act = acts.find(a => a.action_type === type)
    const val = actVals.find(a => a.action_type === type)
    return {
      conversions:     act ? parseFloat(act.value || '0') : -1, // -1 = not found
      conversionValue: val ? parseFloat(val.value || '0') : 0,
    }
  }

  // Primary action — if the action type exists in the data, always use it (even if 0)
  // to avoid falling through to unrelated action types when there are no conversions.
  const primary = getVal(primaryAction)
  if (primary.conversions >= 0) {
    return { conversions: primary.conversions, conversionValue: primary.conversionValue }
  }

  // Primary not found at all — try configured fallback
  if (fallbackAction) {
    const fb = getVal(fallbackAction)
    if (fb.conversions >= 0) {
      return { conversions: fb.conversions, conversionValue: fb.conversionValue }
    }
  }

  // Last resort: try omni_purchase (Meta's canonical aggregate purchase event)
  if (primaryAction !== 'omni_purchase' && fallbackAction !== 'omni_purchase') {
    const omni = getVal('omni_purchase')
    if (omni.conversions >= 0) {
      return { conversions: omni.conversions, conversionValue: omni.conversionValue }
    }
  }

  return { conversions: 0, conversionValue: 0 }
}
