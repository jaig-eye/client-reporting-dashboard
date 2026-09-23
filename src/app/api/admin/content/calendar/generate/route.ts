// POST /api/admin/content/calendar/generate
// Bulk-generates topics across a content calendar window.
// Reads posts_per_run and schedule_frequency from the client's saved schedule —
// the modal only sends start_date and weeks_ahead.
//
// Body: { client_id, start_date?, weeks_ahead }
// Returns: { queued: true, slots: string[] } — or { queued: false, slots, reason } when all slots occupied

import { NextRequest, NextResponse }      from 'next/server'
import { waitUntil }                      from '@vercel/functions'
import { cookies }                        from 'next/headers'
import { createAdminClient }              from '@/lib/supabase/server'
import { unsuppressSlot } from '@/lib/content/slotSuppression'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { logActivity }                    from '@/lib/activity'
import { generateTopicsForClient }        from '@/lib/content/generateTopics'

export const maxDuration = 300

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as {
    client_id: string; start_date?: string; weeks_ahead?: number; silo_id?: string
    content_type?: string
    /**
     * Reopen dates a human previously emptied. Suppression is what makes deleting stick, so
     * it is deliberately sticky — but nothing could clear it, which left a deleted date
     * permanently unfillable by any automatic path. An explicit "generate these dates"
     * request from an admin IS the intent to reopen them, so it is honoured here and only
     * here; the cron never clears a suppression.
     */
    reopen_suppressed?: boolean
  }
  const { client_id, start_date, weeks_ahead: weeksAheadParam, silo_id, content_type } = body

  if (!client_id) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

  const db = createAdminClient()

  // ── Load saved schedule config ─────────────────────────────────────────────
  const { data: schedule } = await db
    .from('content_settings')
    .select('schedule_frequency, schedule_day_of_week, monthly_publish_day, weeks_ahead, schedule_start_date, posts_per_run')
    .eq('client_id', client_id)
    .maybeSingle()

  const frequency  = (schedule?.schedule_frequency ?? 'weekly')
  const dayOfWeek  = (schedule?.schedule_day_of_week ?? 1)
  const weeksAhead = weeksAheadParam ?? (schedule?.weeks_ahead ?? 6)
  // How many posts each cadence window gets. One unless the client says otherwise; the column's
  // own CHECK allows 1..10 and this clamps to the same range so a bad value can't widen the plan.
  const postsPerRun = Math.min(10, Math.max(1, Number(schedule?.posts_per_run ?? 1) || 1))

  // Anchor precedence: an explicit start_date from the caller, then the client's saved
  // schedule_start_date, then today. The saved start date used to be ignored entirely,
  // so callers that send no start_date — "Generate from Silo" is one — anchored a
  // monthly series on whatever day the button happened to be clicked, producing an
  // off-cadence series the cron will never reconcile (its slot guard matches on exact
  // date, so both series then coexist and the client gets two posts that month).
  const scheduleStartDate = (schedule?.schedule_start_date as string | null) ?? null
  const anchor = start_date          ? new Date(start_date)
               : scheduleStartDate   ? new Date(scheduleStartDate + 'T00:00:00Z')
               : new Date()

  // ── Compute publish slots synchronously ────────────────────────────────────
  const monthlyPublishDay = (schedule?.monthly_publish_day as number | null) ?? null
  const slots: string[] = computeSlots({
    anchor, weeksAhead, frequency, dayOfWeek, monthlyPublishDay, scheduleStartDate,
  })

  // Count what each slot already holds, rather than whether it holds anything. With
  // postsPerRun = 1 this behaves exactly as the old Set did — it still prevents duplicate topics
  // when the wizard fires twice — and above 1 it lets a date fill up to its quota.
  const { data: existingTopics } = await db
    .from('content_topics')
    .select('target_publish_date')
    .eq('client_id', client_id)
    .in('target_publish_date', slots)

  const topicsOnDate = new Map<string, number>()
  for (const t of (existingTopics ?? []) as { target_publish_date: string }[]) {
    topicsOnDate.set(t.target_publish_date, (topicsOnDate.get(t.target_publish_date) ?? 0) + 1)
  }

  // Respect slots a human deliberately emptied (migration 209). Without this, manually
  // regenerating a plan resurrects exactly the dates someone just deleted — the same
  // trap the cron had.
  const { data: sup, error: supErr } = await db
    .from('content_slot_suppressions')
    .select('target_publish_date')
    .eq('client_id', client_id)
    .in('target_publish_date', slots)
  if (supErr) {
    console.warn(`[calendar/generate] slot suppressions unavailable (apply migration 209): ${supErr.message}`)
  }
  const suppressedDates = new Set(
    ((sup ?? []) as { target_publish_date: string }[]).map(s => s.target_publish_date),
  )

  // An explicit reopen clears the suppressions for the requested window first, so the slots
  // below are genuinely open rather than being skipped again on the next run.
  if (body.reopen_suppressed && suppressedDates.size > 0) {
    await Promise.all(
      Array.from(suppressedDates).map(d => unsuppressSlot(db, client_id, d)),
    )
    suppressedDates.clear()
  }

  // One entry per post still wanted, so a date needing two posts appears twice. The assignment
  // loop below walks this list positionally, so repeats need no special handling there.
  const openSlots: string[] = []
  for (const s of slots) {
    if (suppressedDates.has(s)) continue
    const wanted = postsPerRun - (topicsOnDate.get(s) ?? 0)
    for (let i = 0; i < wanted; i++) openSlots.push(s)
  }

  if (openSlots.length === 0) {
    return NextResponse.json({
      ok: true, queued: false, slots,
      reason: suppressedDates.size > 0
        ? 'These dates were deliberately emptied. Re-send with reopen_suppressed to fill them again.'
        : 'All slots already have topics',
      suppressed: Array.from(suppressedDates),
    })
  }

  // Read admin session before returning — cookies are request-scoped and unavailable inside waitUntil.
  const adminSession = await getAdminSession()

  // ── Generate topics + assign dates in background ─────────────────────────
  // Batch into groups of 10 — 8192 max_tokens fits ~10 topics with full rationale.
  // Each successive batch automatically avoids previously inserted topics via the
  // existing avoidSet logic in generateTopicsForClient.
  const BATCH_SIZE = 10
  waitUntil(
    (async () => {
      // Purge orphaned pending topics with no publish date from previous jobs killed mid-run.
      // Scoped to status='pending' — approved/generated topics may intentionally have no date.
      await db.from('content_topics')
        .delete()
        .eq('client_id', client_id)
        .eq('status', 'pending')
        .is('target_publish_date', null)
        .lt('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())

      // Re-check open slots — a concurrent request may have queued its own job between
      // our sync check above and when this background task actually starts.
      const wantedDates = Array.from(new Set(openSlots))
      const { data: nowFilled } = await db
        .from('content_topics')
        .select('target_publish_date')
        .eq('client_id', client_id)
        .in('target_publish_date', wantedDates)
        .not('target_publish_date', 'is', null)
      const filledOnDate = new Map<string, number>()
      for (const t of (nowFilled ?? []) as { target_publish_date: string }[]) {
        filledOnDate.set(t.target_publish_date, (filledOnDate.get(t.target_publish_date) ?? 0) + 1)
      }
      // Rebuilt from the same rule as openSlots, so a slot another request filled while this one
      // waited drops out — and a slot it only part-filled keeps the remainder.
      const trulyOpenSlots: string[] = []
      for (const d of wantedDates.sort()) {
        const wanted = postsPerRun - (filledOnDate.get(d) ?? 0)
        for (let i = 0; i < wanted; i++) trulyOpenSlots.push(d)
      }

      if (trulyOpenSlots.length === 0) return

      const count = Math.min(trulyOpenSlots.length, 50)
      let inserted = 0
      const totalBatches = Math.ceil(count / BATCH_SIZE)
      for (let b = 0; b < totalBatches; b++) {
        const batchCount = Math.min(BATCH_SIZE, count - inserted)
        const result = await generateTopicsForClient(db, client_id, batchCount, undefined,
          { suppressEmail: true, siloId: silo_id ?? undefined, contentType: content_type ?? undefined })
        if (result.error) {
          console.error(`[calendar/generate] batch ${b + 1}/${totalBatches} error:`, result.error)
          break
        }
        if (!result.topics.length) {
          console.error(`[calendar/generate] batch ${b + 1}/${totalBatches} returned 0 topics`)
          break
        }
        const fittingTopics = result.topics.slice(0, trulyOpenSlots.length - inserted)
        await Promise.all(fittingTopics.map(async (t, i) => {
          const slotIndex   = inserted + i
          const publishDate = trulyOpenSlots[slotIndex]
          const { error: updateErr } = await db.from('content_topics').update({ target_publish_date: publishDate }).eq('id', t.id)
          if (updateErr) console.error(`[calendar/generate] failed to assign ${publishDate} to topic ${t.id}:`, updateErr.message)
        }))
        inserted += fittingTopics.length
        console.log(`[calendar/generate] batch ${b + 1}/${totalBatches}: ${result.topics.length} topics (total ${inserted})`)
      }

      await logActivity(adminSession, 'generated', 'calendar', { clientId: client_id, meta: { slots: inserted } })
    })()
  )

  return NextResponse.json({ ok: true, queued: true, slots: openSlots })
}

// ── Slot computation ───────────────────────────────────────────────────────

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Cadence dates for a window, WITHOUT the past-date guard. Prefer computeSlots below.
 * Split out only because the cadence branches have several return points and the guard
 * belongs in exactly one place.
 */
function computeSlotsRaw(params: {
  anchor:     Date
  weeksAhead: number
  frequency:  string
  dayOfWeek:  number
  monthlyPublishDay?: number | null
  scheduleStartDate?: string | null
}): string[] {
  const { anchor, weeksAhead, frequency, dayOfWeek, monthlyPublishDay = null, scheduleStartDate = null } = params
  const end     = new Date(anchor.getTime() + weeksAhead * 7 * 86_400_000)
  const slots:  string[] = []

  if (frequency === 'daily') {
    let cur = new Date(anchor)
    while (cur <= end) { slots.push(toIso(cur)); cur = new Date(cur.getTime() + 86_400_000) }
    return slots
  }

  if (frequency === 'weekly' || frequency === 'biweekly') {
    const intervalDays = frequency === 'biweekly' ? 14 : 7
    // Advance anchor to the next matching day of week
    let cur = new Date(anchor)
    const anchorDay = cur.getDay()
    const daysUntil = (dayOfWeek - anchorDay + 7) % 7
    cur = new Date(cur.getTime() + daysUntil * 86_400_000)
    while (cur <= end) {
      slots.push(toIso(cur))
      cur = new Date(cur.getTime() + intervalDays * 86_400_000)
    }
    return slots
  }

  if (frequency === 'monthly' || frequency === 'monthly_first' || frequency === 'monthly_mid' || frequency === 'monthly_end') {
    // Rolling monthly uses the configured publish day when there is one, and only
    // falls back to the anchor's day otherwise. monthly_publish_day was already
    // being loaded from content_settings here and then ignored, so a client with an
    // explicit day still got slots on whatever day the caller happened to anchor to.
    // monthly_end is 28 here to match the cron (content-topics computeFutureSlots).
    // It was 31, so the two generators disagreed about what "end of month" means and
    // produced different dates for the same client — 28 vs 30/31 in every month
    // except the 31-day ones, and the cron never reconciles a stray date because its
    // slot guard matches exactly. One definition, and 28 is the safe one: it exists
    // in every month, so the series never shifts around February.
    const targetDay = frequency === 'monthly_first' ? 1
                    : frequency === 'monthly_mid'   ? 15
                    : frequency === 'monthly_end'   ? 28
                    : (monthlyPublishDay && monthlyPublishDay >= 1 && monthlyPublishDay <= 31
                        ? monthlyPublishDay
                        : scheduleStartDate
                          ? new Date(scheduleStartDate + 'T00:00:00Z').getUTCDate()
                          : anchor.getDate())

    let year  = anchor.getFullYear()
    let month = anchor.getMonth() // 0-indexed
    while (true) {
      const candidate = new Date(year, month, Math.min(targetDay, daysInMonth(year, month)))
      if (candidate > end) break
      if (candidate >= anchor) slots.push(toIso(candidate))
      month++
      if (month > 11) { month = 0; year++ }
    }
    return slots
  }

  // Fallback: weekly
  let cur = new Date(anchor)
  while (cur <= end) { slots.push(toIso(cur)); cur = new Date(cur.getTime() + 7 * 86_400_000) }
  return slots
}

/**
 * Cadence dates for the window, never in the past.
 *
 * The guard exists because the start date is a free text field. Setting it earlier than
 * today — the natural thing to try when you want a plan to have begun sooner — produced
 * slots for dates that had already gone. Those do not fail loudly: generation clamps a past
 * target_publish_date to today, so every backdated slot collapsed onto the same day and the
 * client got several posts at once, on a date nobody chose.
 *
 * Dropping them here means an earlier anchor still sets the CADENCE — a monthly plan
 * anchored to the 1st keeps landing on the 1st — while only the dates that can still be
 * honoured are offered. The cron generator applies the same rule (`candidate > now`).
 */
function computeSlots(params: Parameters<typeof computeSlotsRaw>[0]): string[] {
  const today = new Date().toISOString().slice(0, 10)
  return computeSlotsRaw(params).filter(d => d >= today)
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}
