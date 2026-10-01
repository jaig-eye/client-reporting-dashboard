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
 * The day-of-month a rolling-monthly schedule publishes on.
 *
 * This MUST be stable across runs. It used to be `now.getUTCDate()` — today's date —
 * and because this cron runs every day, every run anchored a brand-new monthly
 * series on a different day: run on the 25th and you get the 25th of each month,
 * run on the 26th and you get the 26th as well, and so on. After a week of runs a
 * "monthly" client had seven consecutive publish dates, repeating every month —
 * a week-long burst once a month instead of one post a month.
 *
 * Preference order: the explicitly configured monthly_publish_day, then the day
 * component of the schedule's start date (what the Start date field in the UI
 * means), and only then today — which is now merely a last resort for a client
 * with neither configured, rather than the normal path.
 */
export function rollingMonthlyDay(monthlyPublishDay: number | null, startDate: string | null, now: Date): number {
  if (monthlyPublishDay && monthlyPublishDay >= 1 && monthlyPublishDay <= 31) return monthlyPublishDay
  if (startDate) {
    const d = new Date(startDate + 'T00:00:00Z')
    if (!Number.isNaN(d.getTime())) return d.getUTCDate()
  }
  // Last resort, and it is the ORIGINAL BUG: with no anchor the day-of-month is
  // whatever today happens to be, and because this cron runs every two hours, each
  // new calendar day starts a fresh monthly series — producing a run of consecutive
  // publish dates that repeats every month. Nothing can be done about it here without
  // an anchor, but it must not fail silently the way it did before: this is the one
  // configuration that still reproduces the burst, so say so loudly enough to find
  // in the logs. Fix by setting content_settings.monthly_publish_day (or a
  // schedule_start_date) for the client.
  console.warn(
    `[content-topics cron] MONTHLY CLIENT HAS NO ANCHOR — neither monthly_publish_day nor ` +
    `schedule_start_date is set, so the publish day falls back to today (${now.getUTCDate()}) ` +
    `and WILL drift on every calendar day, recreating the burst. Set monthly_publish_day.`,
  )
  return now.getUTCDate()
}

export function computeFutureSlots(
  frequency: string,
  dayOfWeek: number,
  weeksLookahead: number,
  monthlyPublishDay: number | null = null,
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
    while (cur <= end) { slots.push(cur.toISOString().slice(0, 10)); cur = new Date(cur.getTime() + interval * 86_400_000) }
    return slots
  }

  if (frequency === 'monthly' || frequency === 'monthly_first' || frequency === 'monthly_mid' || frequency === 'monthly_end') {
    const targetDay = frequency === 'monthly_first' ? 1
                    : frequency === 'monthly_mid'   ? 15
                    : frequency === 'monthly_end'   ? 28
                    : rollingMonthlyDay(monthlyPublishDay, scheduleStartDate, now)
    let y = now.getUTCFullYear(), m = now.getUTCMonth()
    while (true) {
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
const SLOT_STATUSES = ['pending', 'approved', 'generating', 'generated', 'scheduled', 'rejected', 'published']

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
      .select('schedule_frequency, schedule_day_of_week, weeks_ahead, monthly_publish_day, schedule_start_date, posts_per_run, auto_generate')
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
    monthly_publish_day: number | null; schedule_start_date: string | null; posts_per_run: number | null
    auto_generate: boolean | null
  }
  const g = (global.data ?? {}) as { schedule_frequency?: string | null; schedule_day_of_week?: number | null }

  const frequency  = s.schedule_frequency ?? g.schedule_frequency ?? 'weekly'
  const dayOfWeek  = s.schedule_day_of_week ?? g.schedule_day_of_week ?? 1
  const cycle      = getCycleDays(frequency)
  const leadWindow = cycle * Math.max(s.weeks_ahead ?? 1, 1)
  const perDate    = Math.min(10, Math.max(1, Number(s.posts_per_run ?? 1) || 1))

  // Past the window by a few cycles, so a full window still answers with the date after it.
  const horizon = leadWindow + cycle * 4
  const slots = computeFutureSlots(frequency, dayOfWeek, Math.ceil(horizon / 7) + 1, s.monthly_publish_day, s.schedule_start_date)
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
function daysFromNow(date: string): number {
  return Math.round((new Date(date + 'T00:00:00Z').getTime() - Date.now()) / 86_400_000)
}
