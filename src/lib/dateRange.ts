// The date window every client dashboard page opens on.
//
// Each page used to compute its own default, and they disagreed: the Summary and Analytics pages
// ended yesterday while CRM and Business Profile ended today, so a client comparing ad spend to
// leads was comparing two different periods without being told. One helper, one window.
//
// The window ends YESTERDAY on purpose: today's numbers are still arriving from every platform we
// sync, so including today would show a partial day next to complete ones and read as a collapse.

/** Days shown when the client has not picked a range. */
export const DEFAULT_RANGE_DAYS = 30

export interface DashboardRange {
  fromDate: Date
  toDate:   Date
}

/** The default window: DEFAULT_RANGE_DAYS of complete days, ending yesterday. */
export function defaultDashboardRange(now: Date = new Date()): DashboardRange {
  const toDate   = new Date(now.getTime() - 86_400_000)
  const fromDate = new Date(toDate.getTime() - DEFAULT_RANGE_DAYS * 86_400_000)
  return { fromDate, toDate }
}

/**
 * The window a page should render: whatever the client picked, else the default.
 * An unparseable date falls back rather than rendering an Invalid Date.
 */
export function resolveDashboardRange(params: { from?: string; to?: string }): DashboardRange {
  const fallback = defaultDashboardRange()
  const parse = (value: string | undefined, fallbackDate: Date) => {
    if (!value) return fallbackDate
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? fallbackDate : parsed
  }
  return {
    fromDate: parse(params.from, fallback.fromDate),
    toDate:   parse(params.to,   fallback.toDate),
  }
}
