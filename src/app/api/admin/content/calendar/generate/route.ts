// POST /api/admin/content/calendar/generate
// Bulk-generates topics across a content calendar window.
// Reads posts_per_run, the cadence and the planning window from the client's saved schedule.
//
// Body: { client_id, start_date?, weeks_ahead?, silo_id?, content_type?, dry_run?, regenerate? }
// Returns: { queued: true, slots: string[], dates: number, from_sets } — or { queued: false, slots, reason }
// when all slots are occupied.
// dry_run returns { dry_run: true, slots, dates, cleared, from_sets } — the dates it would plan, which
// of them were cleared, and which a priority set takes — and changes nothing. regenerate fills dates
// a person cleared (deleted, or whose topics were all rejected) as well as empty ones.
//
// Which dates: without start_date (every caller today) the plan covers the dates the topic cron
// covers — today to the end of the client's lead window, on the client's own cadence. With
// start_date it covers weeks_ahead weeks from that date.
//
// Which topics: an active priority set takes the first open dates, one per keyword waiting, oldest
// set first — the split the cron makes date by date. silo_id instead plans only that set's dates.
//
// While a plan runs, content_settings.plan_generation holds { started_at, dates } so the Pipeline
// can show it after a refresh. GET ?client_id= returns it (null when none is running), and the
// schedule hold (lib/content/scheduleHold): { since, stranded } when a schedule change has paused
// the cron for this client, null otherwise. A real blog plan run lifts the hold.

import { NextRequest, NextResponse }      from 'next/server'
import { waitUntil }                      from '@vercel/functions'
import { cookies }                        from 'next/headers'
import { createAdminClient }              from '@/lib/supabase/server'
import { unsuppressSlot } from '@/lib/content/slotSuppression'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { logActivity }                    from '@/lib/activity'
import { generateTopicsForClient }        from '@/lib/content/generateTopics'
import { windowSlots, alignToFortnight, firstWeekdayOfMonth } from '@/lib/content/scheduleSlots'
import { waitingSets, splitSlotsBySets }  from '@/lib/content/siloQueue'
import { readScheduleHold, setScheduleHold, plannedBlogDates, offScheduleDates, resolveCadence, globalCadence } from '@/lib/content/scheduleHold'

export const maxDuration = 300

/** One post to write: its publish date, and the set it comes from (null: the usual selection). */
type PlannedSlot = { slot: string; siloId: string | null }

/** A marker older than this belongs to a run the platform killed (maxDuration is 300s). */
const PLAN_MARKER_TTL_MS = 6 * 60_000

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const clientId = request.nextUrl.searchParams.get('client_id')
  if (!clientId) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

  const db = createAdminClient()
  const [hold, { data, error }] = await Promise.all([
    scheduleHoldFor(db, clientId),
    db.from('content_settings').select('plan_generation').eq('client_id', clientId).maybeSingle(),
  ])
  // Before migration 229 the column is missing: say nothing is running, as before.
  if (error) return NextResponse.json({ running: null, hold })
  const marker = (data as { plan_generation?: { started_at?: string; dates?: string[] } | null } | null)?.plan_generation
  const started = marker?.started_at ? Date.parse(marker.started_at) : NaN
  if (!marker || Number.isNaN(started) || Date.now() - started > PLAN_MARKER_TTL_MS) {
    return NextResponse.json({ running: null, hold })
  }
  return NextResponse.json({ running: { started_at: marker.started_at, dates: Array.isArray(marker.dates) ? marker.dates : [] }, hold })
}

/** The client's schedule hold, with the planned dates the current schedule no longer uses. */
async function scheduleHoldFor(db: ReturnType<typeof createAdminClient>, clientId: string): Promise<{ since: string; stranded: string[] } | null> {
  const since = await readScheduleHold(db, clientId)
  if (!since) return null
  const [own, global, planned] = await Promise.all([
    db.from('content_settings').select('schedule_frequency, schedule_day_of_week, schedule_start_date').eq('client_id', clientId).maybeSingle().then(r => r.data),
    globalCadence(db),
    plannedBlogDates(db, clientId),
  ])
  return { since, stranded: planned ? offScheduleDates(planned, resolveCadence(own, global)) : [] }
}

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
    /** Say which dates would be planned, and plan nothing. For the plan's confirmation. */
    dry_run?: boolean
    /**
     * "Regenerate the plan": a person cleared posts they didn't want and asks for the dates to be
     * filled again. Reopens deleted dates (as reopen_suppressed does) and treats a date whose
     * topics were all rejected as open. The rejected topics stay, so their subjects are still
     * avoided.
     */
    regenerate?: boolean
  }
  const { client_id, start_date, weeks_ahead: weeksAheadParam, silo_id, content_type } = body

  if (!client_id) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

  const db = createAdminClient()

  // ── Load saved schedule config ─────────────────────────────────────────────
  // The agency-wide row is the cron's fallback for a client with no cadence of its own, so it is
  // the plan's too.
  const [own, global] = await Promise.all([
    db.from('content_settings')
      .select('schedule_frequency, schedule_day_of_week, weeks_ahead, schedule_start_date, posts_per_run')
      .eq('client_id', client_id)
      .maybeSingle(),
    db.from('content_settings')
      .select('schedule_frequency, schedule_day_of_week')
      .is('client_id', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  // Unreadable is not "weekly on Monday": planning a client's calendar from defaults would put
  // topics on dates that are not theirs.
  if (own.error) {
    console.error(`[calendar/generate] schedule read failed for ${client_id}:`, own.error.message)
    return NextResponse.json({ error: 'Could not read the schedule. Try again.' }, { status: 500 })
  }
  const schedule = own.data as {
    schedule_frequency: string | null; schedule_day_of_week: number | null
    weeks_ahead: number | null; schedule_start_date: string | null; posts_per_run: number | null
  } | null
  const g = (global.data ?? {}) as { schedule_frequency?: string | null; schedule_day_of_week?: number | null }

  const frequency  = schedule?.schedule_frequency ?? g.schedule_frequency ?? 'weekly'
  const dayOfWeek  = schedule?.schedule_day_of_week ?? g.schedule_day_of_week ?? 1
  // How many posts each cadence window gets. One unless the client says otherwise; the column's
  // own CHECK allows 1..10 and this clamps to the same range so a bad value can't widen the plan.
  const postsPerRun = Math.min(10, Math.max(1, Number(schedule?.posts_per_run ?? 1) || 1))
  const scheduleStartDate = schedule?.schedule_start_date ?? null

  // ── Compute publish slots synchronously ────────────────────────────────────
  // Without a start date the window runs from today, and the dates are the cron's own
  // (windowSlots): the client's cadence, stepped from its saved anchor, out to its lead window.
  //
  // It used to run from the saved schedule_start_date forward by weeks_ahead and then drop the
  // past. Once callers stopped sending start_date, any client whose start date was more than
  // weeks_ahead ago — most established clients — got an empty plan: "nothing to generate".
  //
  // An explicit start_date still plans weeks_ahead weeks from that date.
  const slots: string[] = start_date
    ? computeSlots({
        anchor: new Date(start_date), weeksAhead: weeksAheadParam ?? schedule?.weeks_ahead ?? 6,
        frequency, dayOfWeek, scheduleStartDate,
      })
    : windowSlots({
        frequency, dayOfWeek, weeksAhead: weeksAheadParam ?? schedule?.weeks_ahead, scheduleStartDate,
      })

  if (slots.length === 0) {
    return body.dry_run
      ? NextResponse.json({ ok: true, dry_run: true, slots: [], dates: [], cleared: [], from_sets: [] })
      : NextResponse.json({ ok: true, queued: false, slots: [], reason: 'No publish dates fall in the planning window.' })
  }

  // Count what each slot already holds, rather than whether it holds anything. With
  // postsPerRun = 1 this behaves exactly as the old Set did — it still prevents duplicate topics
  // when the wizard fires twice — and above 1 it lets a date fill up to its quota.
  const { data: existingTopics, error: existingErr } = await db
    .from('content_topics')
    .select('target_publish_date, status')
    .eq('client_id', client_id)
    .in('target_publish_date', slots)
  // A failed read reads as "every slot is empty" and would generate a full quota on top of what the
  // dates already hold. The cron path already refuses in this case; this path now does too.
  if (existingErr) {
    console.error(`[calendar/generate] existing topics read failed for ${client_id}:`, existingErr.message)
    return NextResponse.json({ error: 'Could not read the topics already planned. Try again.' }, { status: 500 })
  }

  // A rejected topic holds its date — rejection is a full stop, as in the cron — except when a
  // person asks to regenerate the plan.
  const regenerate   = body.regenerate === true
  const topicsOnDate = new Map<string, number>()
  const rejectedOnDate = new Set<string>()
  for (const t of (existingTopics ?? []) as { target_publish_date: string; status: string }[]) {
    if (regenerate && t.status === 'rejected') { rejectedOnDate.add(t.target_publish_date); continue }
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

  // The dates a person cleared, which a regenerate fills again: deleted (suppressed), or holding
  // only rejected topics.
  const cleared = regenerate
    ? slots.filter(d => suppressedDates.has(d) || (rejectedOnDate.has(d) && !topicsOnDate.has(d)))
    : []

  // An explicit reopen clears the suppressions for the requested window first, so the slots
  // below are genuinely open rather than being skipped again on the next run. A dry run only
  // reports them as open.
  if ((body.reopen_suppressed || regenerate) && suppressedDates.size > 0) {
    if (!body.dry_run) {
      await Promise.all(
        Array.from(suppressedDates).map(d => unsuppressSlot(db, client_id, d)),
      )
    }
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

  // ── Which set each slot comes from ─────────────────────────────────────────
  // Sets only plan blog posts, as in the cron. A named set (silo_id) fills only as many slots as
  // it has keywords waiting, and the dates after that are left alone. Otherwise the client's active
  // sets take the first slots in the cron's order and the rest go to the usual selection — a plan
  // that ignored them filled the dates an active set was owed with unrelated topics.
  const autoSets = !silo_id && (!content_type || content_type === 'blog')
  let plan: PlannedSlot[] = openSlots.map(slot => ({ slot, siloId: null }))
  if (silo_id && openSlots.length > 0) {
    const waiting = await setWaiting(db, silo_id)
    if (waiting === null) return NextResponse.json({ error: 'Could not read the set’s keywords. Try again.' }, { status: 500 })
    if (!waiting) {
      return NextResponse.json({ ok: true, queued: false, slots, reason: 'Every keyword in this set has been used.' })
    }
    plan = openSlots.slice(0, waiting).map(slot => ({ slot, siloId: silo_id }))
  } else if (autoSets && openSlots.length > 0) {
    const { sets, error } = await waitingSets(db, client_id)
    if (error) console.warn(`[calendar/generate] priority sets unreadable for ${client_id}, planning without them:`, error)
    plan = splitSlotsBySets(openSlots, sets)
  }
  const plannedSlots = plan.map(p => p.slot)

  if (body.dry_run) {
    const dates = Array.from(new Set(plannedSlots))
    return NextResponse.json({
      ok: true, dry_run: true, slots: plannedSlots, dates,
      cleared: cleared.filter(d => dates.includes(d)), from_sets: setShares(plan),
    })
  }

  // A person planning the client's blog dates is what the schedule hold waits for: from here the
  // cron keeps the new schedule's dates filled again. A single priority set's plan, or service
  // pages, is not a re-plan of the schedule and leaves the hold alone.
  if (!silo_id && (!content_type || content_type === 'blog')) await setScheduleHold(db, client_id, false)

  if (plan.length === 0) {
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

  // Mark the run before answering, so a refresh straight after still shows it. Best effort: before
  // migration 229 the column is missing and the plan runs as it always did.
  const startedAt = new Date().toISOString()
  const { error: markErr } = await db.from('content_settings')
    .update({ plan_generation: { started_at: startedAt, dates: Array.from(new Set(plannedSlots)).sort() } })
    .eq('client_id', client_id)
  if (markErr) console.warn(`[calendar/generate] could not mark the plan as running for ${client_id}:`, markErr.message)
  const clearMarker = async () => {
    if (markErr) return
    // Only this run's marker: a newer run may have replaced it.
    const { error } = await db.from('content_settings').update({ plan_generation: null })
      .eq('client_id', client_id).eq('plan_generation->>started_at', startedAt)
    if (error) console.warn(`[calendar/generate] could not clear the running marker for ${client_id}:`, error.message)
  }

  // ── Generate topics + assign dates in background ─────────────────────────
  // Batch into groups of 10 — 8192 max_tokens fits ~10 topics with full rationale.
  // Each successive batch automatically avoids previously inserted topics via the
  // existing avoidSet logic in generateTopicsForClient.
  const BATCH_SIZE = 10
  waitUntil(
    (async () => {
     try {
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
      const wantedDates = Array.from(new Set(plannedSlots))
      let filledQuery = db
        .from('content_topics')
        .select('target_publish_date')
        .eq('client_id', client_id)
        .in('target_publish_date', wantedDates)
        .not('target_publish_date', 'is', null)
      // Same rule as the count above: on a regenerate, rejected topics don't hold their date.
      if (regenerate) filledQuery = filledQuery.neq('status', 'rejected')
      const { data: nowFilled, error: filledErr } = await filledQuery
      if (filledErr) {
        console.error(`[calendar/generate] re-check of open slots failed for ${client_id}, not generating:`, filledErr.message)
        return
      }
      const filledOnDate = new Map<string, number>()
      for (const t of (nowFilled ?? []) as { target_publish_date: string }[]) {
        filledOnDate.set(t.target_publish_date, (filledOnDate.get(t.target_publish_date) ?? 0) + 1)
      }
      // Rebuilt from the same rule as openSlots, so a slot another request filled while this one
      // waited drops out — and a slot it only part-filled keeps the remainder.
      const stillOpen: string[] = []
      for (const d of wantedDates.sort()) {
        const wanted = postsPerRun - (filledOnDate.get(d) ?? 0)
        for (let i = 0; i < wanted; i++) stillOpen.push(d)
      }
      if (stillOpen.length === 0) return

      // Split again by the sets as they stand now. Rebuilt per date, the list can be longer than
      // the plan when posts_per_run is above one, and another run may have used keywords since:
      // neither may let a set take more slots than it has keywords waiting.
      let jobs: PlannedSlot[]
      if (silo_id) {
        const waiting = await setWaiting(db, silo_id)
        if (waiting === null) return
        jobs = stillOpen.slice(0, waiting).map(slot => ({ slot, siloId: silo_id }))
      } else if (autoSets) {
        const { sets, error } = await waitingSets(db, client_id)
        if (error) console.warn(`[calendar/generate] priority sets unreadable for ${client_id}, generating without them:`, error)
        jobs = splitSlotsBySets(stillOpen, sets)
      } else {
        jobs = stillOpen.map(slot => ({ slot, siloId: null }))
      }
      jobs = jobs.slice(0, 50)

      // Consecutive slots from the same source are generated together.
      const segments: { siloId: string | null; slots: string[] }[] = []
      for (const j of jobs) {
        const last = segments[segments.length - 1]
        if (last && last.siloId === j.siloId) last.slots.push(j.slot)
        else segments.push({ siloId: j.siloId, slots: [j.slot] })
      }

      const baseOpts = { suppressEmail: true, contentType: content_type ?? undefined }
      let inserted = 0
      let stopped  = false
      for (const seg of segments) {
        let done = 0
        const totalBatches = Math.ceil(seg.slots.length / BATCH_SIZE)
        for (let b = 0; b < totalBatches && done < seg.slots.length; b++) {
          const batchCount = Math.min(BATCH_SIZE, seg.slots.length - done)
          let result = await generateTopicsForClient(db, client_id, batchCount, undefined,
            seg.siloId ? { ...baseOpts, siloId: seg.siloId } : baseOpts)
          // A set this plan picked (rather than one the caller named) that cannot produce its
          // topics does not hold the dates: the usual selection fills them, as the cron does.
          if (seg.siloId && !silo_id && (result.error || !result.topics.length)) {
            console.warn(`[calendar/generate] silo ${seg.siloId} produced nothing for ${client_id} (${result.error ?? 'no topics'}) — using the usual selection for these dates`)
            result = await generateTopicsForClient(db, client_id, batchCount, undefined, baseOpts)
          }
          if (result.error) {
            console.error(`[calendar/generate] batch for ${client_id} failed:`, result.error)
            stopped = true
            break
          }
          if (!result.topics.length) {
            console.error(`[calendar/generate] batch for ${client_id} returned 0 topics`)
            stopped = true
            break
          }
          const fittingTopics = result.topics.slice(0, seg.slots.length - done)
          await Promise.all(fittingTopics.map(async (t, i) => {
            const publishDate = seg.slots[done + i]
            const { error: updateErr } = await db.from('content_topics').update({ target_publish_date: publishDate }).eq('id', t.id)
            if (updateErr) console.error(`[calendar/generate] failed to assign ${publishDate} to topic ${t.id}:`, updateErr.message)
          }))
          done     += fittingTopics.length
          inserted += fittingTopics.length
          console.log(`[calendar/generate] ${client_id}${seg.siloId ? ` silo ${seg.siloId}` : ''}: ${result.topics.length} topics (total ${inserted})`)
        }
        if (stopped) break
      }

      await logActivity(adminSession, 'generated', 'calendar', { clientId: client_id, meta: { slots: inserted } })
     } finally {
      await clearMarker()
     }
    })()
  )

  // slots carries one entry per post, so a date wanting two posts appears twice; dates is what a
  // human means by "publish dates". Both are returned — the count of work and the count of days.
  return NextResponse.json({
    ok: true, queued: true, slots: plannedSlots, dates: new Set(plannedSlots).size, from_sets: setShares(plan),
  })
}

/** Keywords a set has waiting, or null when they could not be read. */
async function setWaiting(db: ReturnType<typeof createAdminClient>, siloId: string): Promise<number | null> {
  const { count, error } = await db
    .from('content_silo_keywords')
    .select('id', { count: 'exact', head: true })
    .eq('silo_id', siloId)
    .eq('selected', true)
    .is('used_at', null)
  if (error) {
    console.error(`[calendar/generate] keyword count failed for silo ${siloId}:`, error.message)
    return null
  }
  return count ?? 0
}

/** The dates each set takes in a plan, in plan order — what a confirmation shows. */
function setShares(plan: PlannedSlot[]): { silo_id: string; dates: string[] }[] {
  const out: { silo_id: string; dates: string[] }[] = []
  for (const p of plan) {
    if (!p.siloId) continue
    let entry = out.find(e => e.silo_id === p.siloId)
    if (!entry) { entry = { silo_id: p.siloId, dates: [] }; out.push(entry) }
    if (!entry.dates.includes(p.slot)) entry.dates.push(p.slot)
  }
  return out
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
  scheduleStartDate?: string | null
}): string[] {
  const { anchor, weeksAhead, frequency, dayOfWeek, scheduleStartDate = null } = params
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
    // On the client's own fortnight, as the cron plans it, whatever date the window starts on.
    if (frequency === 'biweekly') cur = alignToFortnight(cur, dayOfWeek, scheduleStartDate)
    while (cur <= end) {
      slots.push(toIso(cur))
      cur = new Date(cur.getTime() + intervalDays * 86_400_000)
    }
    return slots
  }

  if (frequency === 'monthly' || frequency === 'monthly_first' || frequency === 'monthly_mid' || frequency === 'monthly_end') {
    // Monthly is the first of the publish weekday (scheduleSlots.firstWeekdayOfMonth), as the
    // cron plans it. monthly_end is 28 here to match the cron too: it was 31, and the two
    // generators then disagreed about the date for the same client, which the cron's exact-date
    // slot guard never reconciles. 28 exists in every month, so the series never shifts.
    let year  = anchor.getFullYear()
    let month = anchor.getMonth() // 0-indexed
    while (true) {
      const targetDay = frequency === 'monthly_first' ? 1
                      : frequency === 'monthly_mid'   ? 15
                      : frequency === 'monthly_end'   ? 28
                      : firstWeekdayOfMonth(year, month, dayOfWeek)
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
