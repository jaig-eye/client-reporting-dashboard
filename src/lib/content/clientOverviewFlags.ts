// The Content page's Clients overview: which of a client's settings and recent results need a
// person, in plain words. Pure — the page reads the facts, this decides what they mean — so the
// rules are tested without a database.

export type FlagLevel = 'issue' | 'info'

export interface OverviewFlag {
  key:   string
  level: FlagLevel
  /** A few words for the table. */
  label: string
  /** What is wrong and what to do about it. */
  tip:   string
}

/** What the flags are decided from. A null count means its read failed: no flag, never a false all-clear. */
export interface OverviewFacts {
  autoGenerate:      boolean
  /** The schedule the planner really uses: the client's own frequency, else the global default. */
  frequency:         string
  monthlyPublishDay: number | null
  scheduleStartDate: string | null
  /** The site posts go to, null when the client has none. Undefined when connections could not be read. */
  site?:             { platform: string; name: string; status: string } | null
  /** Publish dates inside the planning window with room for another topic. */
  openDates:         number | null
  /** Topics planned for future dates, rejected ones aside. */
  plannedFuture:     number | null
  /** Posts waiting for review whose publish date has passed. */
  reviewOverdue:     number | null
  /** Posts whose automatic publish failed in the last 14 days. */
  pushErrors:        number | null
  /** Posts with no featured image because making one failed, in the last 14 days. */
  imageErrors:       number | null
  /** Posts whose SEO title or description WordPress did not keep, in the last 14 days. */
  seoMetaLost:       number | null
}

/**
 * One client's line in the overview, ready to show. Dates are 'YYYY-MM-DD'. A null field means its
 * read failed and shows as "—"; "none" values are spelled out so the two can't be confused.
 */
export interface ClientOverviewRow {
  id:          string
  name:        string
  running:     boolean
  /** Automation's sub-switches that are off while it runs — the planner turns them back on. */
  offSwitches: string[]
  cadence:     string
  window:      string
  startDate:   string | null
  site:        { platform: string; name: string; status: string; mode: string | null } | 'none' | null
  planned:     { through: string | null; open: number | null } | null
  review:      { count: number; overdue: number } | null
  lastPublished: { date: string | null; daysAgo: number | null } | null
  length:      number | null
  dfs:         { connected: boolean; researchedAt: string | null } | null
  prioritySets: number | null
  flags:       OverviewFlag[]
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

const STATUS_WORD: Record<string, string> = {
  paused: 'paused', error: 'in error', disconnected: 'disconnected', pending: 'not finished',
}

/**
 * Everything worth a person's attention for one client, issues first. An issue is something that
 * is wrong or will go wrong; info is worth knowing but harmless.
 */
export function overviewFlags(f: OverviewFacts): OverviewFlag[] {
  const flags: OverviewFlag[] = []
  const issue = (key: string, label: string, tip: string) => flags.push({ key, level: 'issue', label, tip })

  // A connection that exists but is not working says more than "no site", so only one of the two.
  if (f.site && f.site.status !== 'active') {
    const word = STATUS_WORD[f.site.status] ?? f.site.status
    issue('site_inactive', `Site ${word}`,
      `The ${f.site.platform} connection for ${f.site.name} is ${word}. ` +
      (f.autoGenerate ? 'Finished posts can’t be published until it works again. ' : '') +
      'Reconnect it on the client’s Connections tab.')
  } else if (f.site === null && f.autoGenerate) {
    issue('no_site', 'No site to publish to',
      'Automation is running, but this client has no WordPress or BigCommerce connection, so finished posts have nowhere to go. ' +
      'Connect the site on the client’s Connections tab, or pause automation in Content settings.')
  }

  if (f.autoGenerate && (f.openDates ?? 0) > 0) {
    issue('planner_behind', `${plural(f.openDates!, 'date')} not planned`,
      `Automation is on, but ${plural(f.openDates!, 'publish date')} inside the planning window ${f.openDates === 1 ? 'has' : 'have'} no topic yet. ` +
      'The planner fills the window every two hours, so a date that has just come into range can show here briefly. ' +
      'If it stays, open the client’s Pipeline to see why topics aren’t being added.')
  }

  if ((f.reviewOverdue ?? 0) > 0) {
    issue('review_overdue', `${plural(f.reviewOverdue!, 'review')} past date`,
      `${plural(f.reviewOverdue!, 'post')} waiting for review ${f.reviewOverdue === 1 ? 'has' : 'have'} a publish date that has already gone by. ` +
      'Review them in Monthly Review or the client’s Pipeline, then publish them or give them new dates.')
  }

  if ((f.pushErrors ?? 0) > 0) {
    issue('push_error', 'Publishing failed',
      `Automatic publishing failed for ${plural(f.pushErrors!, 'post')} in the last 14 days and ${f.pushErrors === 1 ? 'it hasn’t' : 'they haven’t'} been published since. ` +
      'Open the client’s Pipeline and publish by hand; if that fails too, it shows the reason.')
  }

  if ((f.imageErrors ?? 0) > 0) {
    issue('image_error', 'Image failed',
      `${plural(f.imageErrors!, 'post')} from the last 14 days ${f.imageErrors === 1 ? 'has' : 'have'} no featured image because making one failed. ` +
      'Open the post and use Generate image, or choose a stock image.')
  }

  if ((f.seoMetaLost ?? 0) > 0) {
    issue('seo_meta', 'SEO fields not saved',
      `WordPress didn’t keep the SEO title or description for ${plural(f.seoMetaLost!, 'post')} in the last 14 days. ` +
      'Add them by hand in WordPress. System → Activity Log lists which fields on which post.')
  }

  if (f.frequency === 'monthly' && !f.monthlyPublishDay && !f.scheduleStartDate) {
    issue('monthly_drift', 'Monthly date drifts',
      'This client publishes monthly but has no publish day or start date, so the day of the month moves and posts can bunch up. ' +
      'Set a start date in Content settings.')
  }

  if (f.frequency === 'biweekly' && !f.scheduleStartDate) {
    issue('biweekly_anchor', 'No start date',
      'An every-two-weeks schedule counts its weeks from the start date. Without one the planner can’t tell which week is on, ' +
      'and posts can land every week. Set a start date in Content settings.')
  }

  if (!f.autoGenerate && (f.plannedFuture ?? 0) > 0) {
    flags.push({
      key: 'paused_with_plan', level: 'info', label: `Paused, ${f.plannedFuture} planned`,
      tip: `Automation is paused, but ${plural(f.plannedFuture!, 'topic')} ${f.plannedFuture === 1 ? 'is' : 'are'} still planned for future dates. ` +
        'Nothing will write or publish them automatically. Write them from the Pipeline, or turn automation back on.',
    })
  }

  return flags
}

export const issueCount = (flags: OverviewFlag[]) => flags.filter(x => x.level === 'issue').length

/** Clients with an issue first, then by name. */
export function sortOverviewRows<T extends { name: string; flags: OverviewFlag[] }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ia = issueCount(a.flags) > 0 ? 0 : 1
    const ib = issueCount(b.flags) > 0 ? 0 : 1
    return ia - ib || a.name.localeCompare(b.name)
  })
}

/**
 * Dates in the window with room for another topic: not suppressed, and holding fewer topics than
 * the client publishes per date — the same test the planner makes before it fills a date.
 */
export function countOpenDates(
  slots: string[],
  topicDates: string[],
  suppressed: Iterable<string>,
  perDate: number,
): number {
  const per = Math.min(10, Math.max(1, Number(perDate) || 1))
  const filled = new Map<string, number>()
  for (const d of topicDates) filled.set(d, (filled.get(d) ?? 0) + 1)
  const off = new Set(suppressed)
  return slots.filter(s => !off.has(s) && (filled.get(s) ?? 0) < per).length
}
