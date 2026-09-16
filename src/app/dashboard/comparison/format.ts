// Shapes and formatting shared by the Period Comparison page and its table.
//
// This lives outside ComparisonTable because that file is a client component: a function exported
// from a 'use client' module becomes a client reference, and calling it on the server throws.

export type MetricFormat = 'number' | 'money' | 'percent' | 'position' | 'duration'

export interface ComparisonMetric {
  label:    string
  current:  number
  previous: number
  format:   MetricFormat
  /** Cost per lead, cost per click, cost per thousand, average position: down is the good direction. */
  lowerIsBetter?: boolean
  /** Shown under "key metrics"; the rest appear when the filter is set to every metric. */
  key?: boolean
}

export interface ComparisonSection {
  id:      string
  name:    string
  /** Tints the group header, matching the colour that channel has elsewhere. */
  color:   string
  /**
   * Connector type, so the group header can carry the platform's own logo. Sections with no
   * platform behind them (a white-labelled CRM) leave it unset and fall back to the colour dot.
   */
  logo?:   string
  metrics: ComparisonMetric[]
}

const fmtNumber   = (n: number) => Math.round(n).toLocaleString('en-US')
const fmtMoney    = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtPercent  = (n: number) => `${(n * 100).toFixed(2)}%`
const fmtPosition = (n: number) => (n > 0 ? n.toFixed(1) : '—')
const fmtDuration = (n: number) => {
  const m = Math.floor(n / 60)
  const s = Math.round(n % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export function formatMetric(value: number, format: MetricFormat): string {
  if (!isFinite(value)) return '—'
  switch (format) {
    case 'money':    return fmtMoney(value)
    case 'percent':  return fmtPercent(value)
    case 'position': return fmtPosition(value)
    case 'duration': return fmtDuration(value)
    default:         return fmtNumber(value)
  }
}

/** Percent change, or null when there is nothing to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

/** Whether a change is an improvement: for a cost, down is up. */
export function isImprovement(pct: number, lowerIsBetter?: boolean): boolean {
  return lowerIsBetter ? pct < 0 : pct > 0
}
