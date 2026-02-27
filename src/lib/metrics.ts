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
  }
}

export function getDailyTrend(rows: CampaignMetric[]): DailyMetric[] {
  const byDate: Record<string, DailyMetric> = {}
  for (const row of rows) {
    const date = row.date.split('T')[0]
    if (!byDate[date]) {
      byDate[date] = { date, spend: 0, conversions: 0, clicks: 0, roas: 0 }
    }
    byDate[date].spend += Number(row.spend)
    byDate[date].conversions += Number(row.conversions)
    byDate[date].clicks += Number(row.clicks)
  }
  // Calculate ROAS per day (needs conversion_value)
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date))
}

export function calcDelta(current: number, prior: number): number {
  if (prior === 0) return current > 0 ? 100 : 0
  return ((current - prior) / prior) * 100
}

export function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(n))
}

export function formatPercent(n: number): string {
  return `${(n * 100).toFixed(2)}%`
}

export function formatRoas(n: number): string {
  return `${n.toFixed(2)}x`
}
