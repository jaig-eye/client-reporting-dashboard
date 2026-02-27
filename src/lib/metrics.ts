import type { CampaignMetric, MetricSummary, DailyMetric } from './types'

export function summarizeMetrics(rows: CampaignMetric[]): MetricSummary {
  const spend = rows.reduce((s, r) => s + Number(r.spend), 0)
  const impressions = rows.reduce((s, r) => s + Number(r.impressions), 0)
  const clicks = rows.reduce((s, r) => s + Number(r.clicks), 0)
  const conversions = rows.reduce((s, r) => s + Number(r.conversions), 0)
  const conversionValue = rows.reduce((s, r) => s + Number(r.conversion_value), 0)

  return {
    spend,
    impressions,
    clicks,
    conversions,
    conversionValue,
    roas: spend > 0 ? conversionValue / spend : 0,
    ctr: impressions > 0 ? clicks / impressions : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    cpl: conversions > 0 ? spend / conversions : 0,
  }
}

export function getDailyTrend(rows: CampaignMetric[]): DailyMetric[] {
  const byDate: Record<string, { spend: number; conversions: number; clicks: number; conversionValue: number }> = {}

  for (const row of rows) {
    const date = String(row.date).split('T')[0]
    if (!byDate[date]) byDate[date] = { spend: 0, conversions: 0, clicks: 0, conversionValue: 0 }
    byDate[date].spend += Number(row.spend)
    byDate[date].conversions += Number(row.conversions)
    byDate[date].clicks += Number(row.clicks)
    byDate[date].conversionValue += Number(row.conversion_value)
  }

  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      spend: d.spend,
      conversions: d.conversions,
      clicks: d.clicks,
      roas: d.spend > 0 ? d.conversionValue / d.spend : 0,
    }))
}

export function calcDelta(current: number, prior: number): number {
  if (prior === 0) return current > 0 ? 100 : 0
  return ((current - prior) / Math.abs(prior)) * 100
}

export function fmt$ (n: number): string {
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
