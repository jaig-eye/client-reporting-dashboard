// Shared clean-up for ad-level rows read on the campaign and ad group pages.

/** The Google Ads sync's $0 stand-in for a paused ad group. It carries a status; it is not an ad. */
export const AD_GROUP_PLACEHOLDER = 'AD_GROUP_PLACEHOLDER'

/**
 * One row per ad per day. A client with two connections to the same ad account (an old one and a
 * reconnected one) has every ad stored twice for each date; summing both doubles the spend.
 * Placeholder rows are dropped too, so they never count as ads or add to totals.
 */
export function dedupeAdDays<T extends { ad_id?: string | null; date?: string | null; ad_type?: string | null }>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows.filter(r => {
    if (r.ad_type === AD_GROUP_PLACEHOLDER) return false
    const key = `${r.ad_id ?? ''}:${r.date ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
