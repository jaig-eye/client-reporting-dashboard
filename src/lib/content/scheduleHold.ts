// The schedule hold: after a schedule change, automatic planning waits for a person.
//
// The topic cron fills every date of the CURRENT schedule that has nothing on it. Topics planned
// under the old schedule sit on the old dates, so a schedule change made every new date look
// empty and the cron planned them on top of the old plan. Now a save that moves the dates, while
// planned topics sit on dates the new schedule doesn't use, sets content_settings.schedule_hold_since;
// the cron skips the client while it is set; Regenerate plan plans the new dates and clears it.
// Column from migration 230. Every read and write here tolerates its absence.

import type { SupabaseClient } from '@supabase/supabase-js'
import { computeFutureSlots, SLOT_STATUSES } from '@/lib/content/scheduleSlots'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>

/** The settings that decide which dates a client publishes on. */
export const CADENCE_FIELDS = ['schedule_frequency', 'schedule_day_of_week', 'schedule_start_date'] as const

export interface Cadence {
  frequency:         string
  dayOfWeek:         number
  scheduleStartDate: string | null
}

/** Statuses of a topic still waiting for its date: planned, not yet live and not turned down. */
export const PLANNED_STATUSES = SLOT_STATUSES.filter(s => s !== 'rejected' && s !== 'published')

/** Far enough ahead to compare two schedules: half a year covers every planning window. */
const COMPARE_WEEKS = 26

/** Whether two schedules publish on different dates. Field-by-field equality is not enough: a weekday on a fixed-date monthly schedule changes nothing. */
export function cadenceMoved(before: Cadence, after: Cadence): boolean {
  const a = computeFutureSlots(before.frequency, before.dayOfWeek, COMPARE_WEEKS, before.scheduleStartDate)
  const b = computeFutureSlots(after.frequency, after.dayOfWeek, COMPARE_WEEKS, after.scheduleStartDate)
  return a.join() !== b.join()
}

/** The planned dates a schedule doesn't publish on. */
export function offScheduleDates(plannedDates: string[], cadence: Cadence): string[] {
  if (plannedDates.length === 0) return []
  const last = plannedDates.reduce((m, d) => (d > m ? d : m))
  const weeks = Math.ceil((Date.parse(last + 'T00:00:00Z') - Date.now()) / (7 * 86_400_000)) + 1
  const onSchedule = new Set(computeFutureSlots(cadence.frequency, cadence.dayOfWeek, Math.max(weeks, 1), cadence.scheduleStartDate))
  return Array.from(new Set(plannedDates.filter(d => !onSchedule.has(d)))).sort()
}

/** Future blog topics still waiting for their date. Service-area pages run on their own schedule. */
export async function plannedBlogDates(db: Db, clientId: string): Promise<string[] | null> {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await db
    .from('content_topics')
    .select('target_publish_date')
    .eq('client_id', clientId)
    .gt('target_publish_date', today)
    .in('status', PLANNED_STATUSES)
    .or('content_type.is.null,content_type.neq.service_area')
    .limit(1000)
  if (error) return null
  return ((data ?? []) as { target_publish_date: string | null }[])
    .map(r => r.target_publish_date).filter((d): d is string => !!d)
}

/** A client's schedule as the cron reads it: its own, else the agency default. */
export function resolveCadence(
  own: { schedule_frequency?: unknown; schedule_day_of_week?: unknown; schedule_start_date?: unknown } | null,
  global: { schedule_frequency?: unknown; schedule_day_of_week?: unknown } | null,
): Cadence {
  return {
    frequency:         String(own?.schedule_frequency ?? global?.schedule_frequency ?? 'weekly'),
    dayOfWeek:         Number(own?.schedule_day_of_week ?? global?.schedule_day_of_week ?? 1),
    scheduleStartDate: (own?.schedule_start_date as string | null | undefined) ?? null,
  }
}

/** The agency's default schedule, the newest global row (there can be more than one). */
export async function globalCadence(db: Db): Promise<{ schedule_frequency?: string | null; schedule_day_of_week?: number | null } | null> {
  const { data } = await db
    .from('content_settings')
    .select('schedule_frequency, schedule_day_of_week')
    .is('client_id', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as { schedule_frequency?: string | null; schedule_day_of_week?: number | null } | null
}

/** Set or clear the hold. False when the column isn't there yet (migration 230). */
export async function setScheduleHold(db: Db, clientId: string, on: boolean): Promise<boolean> {
  const { error } = await db
    .from('content_settings')
    .update({ schedule_hold_since: on ? new Date().toISOString() : null })
    .eq('client_id', clientId)
  if (error) console.warn(`[schedule-hold] could not ${on ? 'set' : 'clear'} the hold for ${clientId} (apply migration 230?): ${error.message}`)
  return !error
}

/** When the client's hold started, or null: none, or the column isn't there yet. */
export async function readScheduleHold(db: Db, clientId: string): Promise<string | null> {
  const { data, error } = await db.from('content_settings').select('schedule_hold_since').eq('client_id', clientId).maybeSingle()
  if (error) return null
  return (data as { schedule_hold_since?: string | null } | null)?.schedule_hold_since ?? null
}

/** Every client on hold, for the cron. Empty when the column isn't there yet. */
export async function heldClientIds(db: Db): Promise<Set<string>> {
  const { data, error } = await db.from('content_settings').select('client_id').not('schedule_hold_since', 'is', null)
  if (error) {
    console.warn(`[schedule-hold] holds unreadable (apply migration 230?): ${error.message}`)
    return new Set()
  }
  return new Set(((data ?? []) as { client_id: string | null }[]).map(r => r.client_id).filter((id): id is string => !!id))
}
