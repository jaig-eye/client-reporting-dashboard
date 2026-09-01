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
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { logActivity }                    from '@/lib/activity'
import { generateTopicsForClient }        from '@/lib/content/generateTopics'

export const maxDuration = 300

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as { client_id: string; start_date?: string; weeks_ahead?: number; silo_id?: string; content_type?: string }
  const { client_id, start_date, weeks_ahead: weeksAheadParam, silo_id, content_type } = body

  if (!client_id) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

  const db = createAdminClient()

  // ── Load saved schedule config ─────────────────────────────────────────────
  const { data: schedule } = await db
    .from('content_settings')
    .select('schedule_frequency, schedule_day_of_week, monthly_publish_day, weeks_ahead')
    .eq('client_id', client_id)
    .maybeSingle()

  const frequency  = (schedule?.schedule_frequency ?? 'weekly')
  const dayOfWeek  = (schedule?.schedule_day_of_week ?? 1)
  const weeksAhead = weeksAheadParam ?? (schedule?.weeks_ahead ?? 6)
  const anchor     = start_date ? new Date(start_date) : new Date()

  // ── Compute publish slots synchronously ────────────────────────────────────
  const monthlyPublishDay = (schedule?.monthly_publish_day as number | null) ?? null
  const slots: string[] = computeSlots({ anchor, weeksAhead, frequency, dayOfWeek, monthlyPublishDay })

  // Skip slots that already have topics assigned — prevents duplicate topics when the
  // wizard fires this endpoint twice (e.g. double-click, network retry).
  const { data: existingTopics } = await db
    .from('content_topics')
    .select('target_publish_date')
    .eq('client_id', client_id)
    .in('target_publish_date', slots)

  const existingDates = new Set((existingTopics ?? []).map(t => t.target_publish_date as string))
  const openSlots = slots.filter(s => !existingDates.has(s))

  if (openSlots.length === 0) {
    return NextResponse.json({ ok: true, queued: false, slots, reason: 'All slots already have topics' })
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
      const { data: nowFilled } = await db
        .from('content_topics')
        .select('target_publish_date')
        .eq('client_id', client_id)
        .in('target_publish_date', openSlots)
        .not('target_publish_date', 'is', null)
      const filledSet = new Set((nowFilled ?? []).map(t => t.target_publish_date as string))
      const trulyOpenSlots = openSlots.filter(s => !filledSet.has(s))

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

function computeSlots(params: {
  anchor:     Date
  weeksAhead: number
  frequency:  string
  dayOfWeek:  number
  monthlyPublishDay?: number | null
}): string[] {
  const { anchor, weeksAhead, frequency, dayOfWeek, monthlyPublishDay = null } = params
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
    const targetDay = frequency === 'monthly_first' ? 1
                    : frequency === 'monthly_mid'   ? 15
                    : frequency === 'monthly_end'   ? 31
                    : (monthlyPublishDay && monthlyPublishDay >= 1 && monthlyPublishDay <= 31
                        ? monthlyPublishDay
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

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}
