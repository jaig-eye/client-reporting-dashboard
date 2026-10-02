// Publish-date arithmetic shared by the topic cron and anything that has to say when the cron will
// next fill a date. Moved here unchanged from /api/cron/content-topics so the two cannot disagree.

import type { SupabaseClient } from '@supabase/supabase-js'

export function getCycleDays(frequency: string): number {
  switch (frequency) {
    case 'monthly': case 'monthly_first': case 'monthly_mid': case 'monthly_end': return 28
    case 'biweekly': return 14
    case 'weekly':   return 7
    default:         return 1
  }
}

export function daysInMonth(year: number, month: number): number {
  // getUTCDate, not getDate. Date.UTC builds the instant for midnight UTC on the
  // month's last day; reading it back with the LOCAL getDate() returns the previous
  // day in any negative-UTC-offset zone, so this reported 30 for a 31-day month when
  // run outside UTC. Harmless on Vercel (UTC) and at day 25, but it silently
  // mis-clamped day-29/30/31 schedules in local development and testing.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

/**
 * The day of the month a Monthly schedule publishes on: the first of the client's publish weekday,
 * so the first Monday, the first Thursday, whichever weekday the schedule names.
 *
 * Monthly used to mean "the same calendar day each month", taken from monthly_publish_day or the
 * start date's day, and with neither set it fell back to today's date. The topic cron runs every
 * two hours, so an anchorless client began a new monthly series every day and got a week of
 * consecutive publish dates once a month. A weekday needs no anchor: every run finds the same
 * date, so that burst cannot happen.
 */
export function firstWeekdayOfMonth(year: number, month: number, dayOfWeek: number): number {
  const firstOfMonth = new Date(Date.UTC(year, month, 1)).getUTCDay()
  return 1 + ((dayOfWeek - firstOfMonth + 7) % 7)
}

const DAY_MS = 86_400_000

/** Days since the epoch of a date's UTC calendar day — the unit cadence arithmetic is done in. */
function utcDay(d: Date): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY_MS)
}

/**
 * Move a biweekly date onto the client's own fortnight.
 *
 * A biweekly series used to start at "the next publish weekday after today". That anchor moves
 * forward a week every week, so successive runs planned alternate weeks and, between them, filled
 * every week: a biweekly client got weekly posts (Landworx did, Monday after Monday). The series
 * now runs from the schedule's start date — its first publish weekday on or after that date — so
 * every run lands on the same fortnight. `date` must already fall on `dayOfWeek`; it is returned as
 * is, or a week later when it is in the off week. With no start date there is nothing to align to
 * and the date stands, as before.
 */
export function alignToFortnight(date: Date, dayOfWeek: number, scheduleStartDate: string | null): Date {
  if (!scheduleStartDate) return date
  const start = new Date(scheduleStartDate + 'T00:00:00Z')
  if (Number.isNaN(start.getTime())) return date
  const first = utcDay(start) + ((dayOfWeek - start.getUTCDay() + 7) % 7)
  const offset = (((utcDay(date) - first) % 14) + 14) % 14
  return offset === 7 ? new Date(date.getTime() + 7 * DAY_MS) : date
}

/** Days ahead the topic cron plans for a client: one cadence cycle per weeks_ahead, at least one. */
export function leadWindowDays(frequency: string, weeksAhead: number | null | undefined): number {
  return getCycleDays(frequency) * Math.max(Number(weeksAhead ?? 1) || 1, 1)
}

/**
 * The publish dates inside a client's planning window: the cadence dates after today, up to the
 * lead window. What the topic cron fills on every run, and what a plan generated now covers — one
 * definition, so a plan and the cron cannot disagree about which dates are the client's.
 */
export function windowSlots(p: {
  frequency:         string
  dayOfWeek:         number
  weeksAhead:        number | null | undefined
  scheduleStartDate: string | null
}): string[] {
  const lead = leadWindowDays(p.frequency, p.weeksAhead)
  return computeFutureSlots(p.frequency, p.dayOfWeek, Math.ceil(lead / 7) + 1, p.scheduleStartDate)
    .filter(slot => { const d = daysFromNow(slot); return d > 0 && d <= lead })
}

export function computeFutureSlots(
  frequency: string,
  dayOfWeek: number,
  weeksLookahead: number,
  scheduleStartDate: string | null = null,
): string[] {
  const now  = new Date()
  const end  = new Date(now.getTime() + weeksLookahead * 7 * 86_400_000)
  const slots: string[] = []

  if (frequency === 'daily') {
    let cur = new Date(now.getTime() + 86_400_000)
    while (cur <= end) { slots.push(cur.toISOString().slice(0, 10)); cur = new Date(cur.getTime() + 86_400_000) }
    return slots
  }

  if (frequency === 'weekly' || frequency === 'biweekly') {
    const interval = frequency === 'biweekly' ? 14 : 7
    let cur = new Date(now)
    const daysUntil = (dayOfWeek - cur.getUTCDay() + 7) % 7 || 7
    cur = new Date(cur.getTime() + daysUntil * 86_400_000)
    if (frequency === 'biweekly') cur = alignToFortnight(cur, dayOfWeek, scheduleStartDate)
    while (cur <= end) { slots.push(cur.toISOString().slice(0, 10)); cur = new Date(cur.getTime() + interval * 86_400_000) }
    return slots
  }

  if (frequency === 'monthly' || frequency === 'monthly_first' || frequency === 'monthly_mid' || frequency === 'monthly_end') {
    let y = now.getUTCFullYear(), m = now.getUTCMonth()
    while (true) {
      const targetDay = frequency === 'monthly_first' ? 1
                      : frequency === 'monthly_mid'   ? 15
                      : frequency === 'monthly_end'   ? 28
                      : firstWeekdayOfMonth(y, m, dayOfWeek)
      const candidate = new Date(Date.UTC(y, m, Math.min(targetDay, daysInMonth(y, m))))
      if (candidate > end) break
      if (candidate > now) slots.push(candidate.toISOString().slice(0, 10))
      m++; if (m > 11) { m = 0; y++ }
    }
    return slots
  }

  return []
}

// Statuses that occupy a publish date, as the topic cron counts them. 'rejected' is one: a date a
// person turned down is dealt with and is not refilled.
export const SLOT_STATUSES = ['pending', 'approved', 'generating', 'generated', 'scheduled', 'rejected', 'published']

export interface NextOpenSlot {
  /** The first future publish date with room for another post. */
  date:         string
  /**
   * When the topic cron gets to it: the day the date enters the client's planning window. Null when
   * it is already inside the window, so the next run (every two hours) fills it.
   */
  picksOn:      string | null
  /** Whether the cron plans topics for this client at all. Without it, only a manual run fills dates. */
  autoGenerate: boolean
}

/**
 * The next date the topic cron will fill for a client, and when — the same window, cadence and
 * occupancy rules the cron applies. Null when the client has no schedule or nothing could be read.
 */
export async function nextOpenSlot(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  clientId: string,
): Promise<NextOpenSlot | null> {
  const [own, global] = await Promise.all([
    db.from('content_settings')
      .select('schedule_frequency, schedule_day_of_week, weeks_ahead, schedule_start_date, posts_per_run, auto_generate')
      .eq('client_id', clientId)
      .maybeSingle(),
    db.from('content_settings')
      .select('schedule_frequency, schedule_day_of_week')
      .is('client_id', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (own.error || !own.data) return null
  const s = own.data as {
    schedule_frequency: string | null; schedule_day_of_week: number | null; weeks_ahead: number | null
    schedule_start_date: string | null; posts_per_run: number | null
    auto_generate: boolean | null
  }
  const g = (global.data ?? {}) as { schedule_frequency?: string | null; schedule_day_of_week?: number | null }

  const frequency  = s.schedule_frequency ?? g.schedule_frequency ?? 'weekly'
  const dayOfWeek  = s.schedule_day_of_week ?? g.schedule_day_of_week ?? 1
  const cycle      = getCycleDays(frequency)
  const leadWindow = leadWindowDays(frequency, s.weeks_ahead)
  const perDate    = Math.min(10, Math.max(1, Number(s.posts_per_run ?? 1) || 1))

  // Past the window by a few cycles, so a full window still answers with the date after it.
  const horizon = leadWindow + cycle * 4
  const slots = computeFutureSlots(frequency, dayOfWeek, Math.ceil(horizon / 7) + 1, s.schedule_start_date)
    .filter(slot => daysFromNow(slot) > 0)
  if (slots.length === 0) return null

  const [topics, suppressions] = await Promise.all([
    db.from('content_topics')
      .select('target_publish_date')
      .eq('client_id', clientId)
      .in('target_publish_date', slots)
      .in('status', SLOT_STATUSES),
    db.from('content_slot_suppressions')
      .select('target_publish_date')
      .eq('client_id', clientId)
      .in('target_publish_date', slots),
  ])
  if (topics.error) return null

  const filled = new Map<string, number>()
  for (const t of (topics.data ?? []) as { target_publish_date: string }[]) {
    filled.set(t.target_publish_date, (filled.get(t.target_publish_date) ?? 0) + 1)
  }
  const suppressed = new Set(((suppressions.data ?? []) as { target_publish_date: string }[]).map(r => r.target_publish_date))

  const date = slots.find(slot => !suppressed.has(slot) && (filled.get(slot) ?? 0) < perDate)
  if (!date) return null

  const inWindow = daysFromNow(date) <= leadWindow
  const picksOn  = inWindow
    ? null
    : new Date(new Date(date + 'T00:00:00Z').getTime() - leadWindow * 86_400_000).toISOString().slice(0, 10)
  return { date, picksOn, autoGenerate: s.auto_generate === true }
}

/** Whole days from now to a date, rounded as the cron rounds them when it decides what is in range. */
export function daysFromNow(date: string): number {
  return Math.round((new Date(date + 'T00:00:00Z').getTime() - Date.now()) / 86_400_000)
}
