// POST /api/admin/content/calendar/generate
// Bulk-generates topics across a content calendar window.
// Reads posts_per_run and schedule_frequency from the client's saved schedule —
// the modal only sends start_date and weeks_ahead.
//
// Body: { client_id, start_date?, weeks_ahead }
// Returns: { count, client_name, slots: string[] }

import { NextRequest, NextResponse }      from 'next/server'
import { cookies }                        from 'next/headers'
import { createAdminClient }              from '@/lib/supabase/server'
import { isAdminAuthed }                  from '@/lib/auth'
import { generateTopicsForClient }        from '@/lib/content/generateTopics'

export const maxDuration = 300

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as { client_id: string; start_date?: string; weeks_ahead?: number }
  const { client_id, start_date, weeks_ahead: weeksAheadParam } = body

  if (!client_id) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

  const db = createAdminClient()

  // ── Load saved schedule config ─────────────────────────────────────────────
  const { data: schedule } = await db
    .from('content_settings')
    .select('posts_per_run, topics_per_run, schedule_frequency, schedule_day_of_week, monthly_publish_day, weeks_ahead')
    .eq('client_id', client_id)
    .maybeSingle()

  const topicsPerRun  = (schedule?.topics_per_run  ?? 5)  // ideas generated per slot
  const frequency     = (schedule?.schedule_frequency ?? 'weekly')
  const dayOfWeek     = (schedule?.schedule_day_of_week ?? 1) // 0=Sun
  const weeksAhead    = weeksAheadParam ?? (schedule?.weeks_ahead ?? 6)
  const anchor        = start_date ? new Date(start_date) : new Date()

  // ── Compute publish slots ──────────────────────────────────────────────────
  const slots: string[] = computeSlots({ anchor, weeksAhead, frequency, dayOfWeek })

  const count = Math.min(slots.length * topicsPerRun, 50)

  if (count === 0) {
    return NextResponse.json({ error: 'No publish slots computed for the given parameters' }, { status: 400 })
  }

  // ── Generate topics (first pass — no publish dates) ───────────────────────
  const result = await generateTopicsForClient(db, client_id, count)

  if (result.error || !result.topics.length) {
    return NextResponse.json({ error: result.error ?? 'No topics generated' }, { status: 500 })
  }

  // ── Assign publish dates across slots ─────────────────────────────────────
  // Distribute topics_per_run ideas per slot so each batch has enough options
  const topicIds = result.topics.map(t => t.id)
  await Promise.all(topicIds.map(async (id, i) => {
    const slotIndex   = Math.floor(i / topicsPerRun)
    const publishDate = slots[slotIndex] ?? slots[slots.length - 1]
    await db
      .from('content_topics')
      .update({ target_publish_date: publishDate })
      .eq('id', id)
  }))

  return NextResponse.json({
    count:       result.count,
    client_name: result.clientName,
    slots,
  })
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
}): string[] {
  const { anchor, weeksAhead, frequency, dayOfWeek } = params
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
    const targetDay = frequency === 'monthly_first' ? 1
                    : frequency === 'monthly_mid'   ? 15
                    : frequency === 'monthly_end'   ? 28
                    : anchor.getDate() // rolling: same day each month

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
