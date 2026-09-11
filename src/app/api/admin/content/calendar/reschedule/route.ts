// POST /api/admin/content/calendar/reschedule
// Body: { client_id, start_date, post_ids?, dry_run? }
//
// Moves already-generated content onto a new cadence anchor.
//
// Until now there was no way to do this at all. Changing the start date only affected which
// EMPTY slots the next generation filled; every existing topic and post kept its old date, so
// a plan that should have shifted stayed put and the two drifted apart. The only recourse was
// deleting the plan and regenerating it, which throws away written articles.
//
// Two rules make this safe enough to expose:
//
//   1. Published and pushed content never moves. Its date is a historical fact - the article
//      is on the client's site under that date, and rewriting our copy would only make the
//      dashboard disagree with reality. Those posts come back as `skipped` so the caller can
//      say why, rather than silently omitting them.
//   2. A post and its topic move TOGETHER. They carry independent target_publish_date columns
//      and neither FK cascades, so moving one alone is what desynchronises the calendar - the
//      exact condition that makes a slot render twice.
//
// dry_run returns the plan without writing, which is what the confirmation step renders: the
// user is shown the same list that will be applied.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { suppressSlots } from '@/lib/content/slotSuppression'

export const dynamic = 'force-dynamic'

type PostRow = {
  id: string
  title: string | null
  topic_id: string | null
  target_publish_date: string | null
  status: string
  wp_post_id: number | null
  bc_post_id: number | null
}

/**
 * A post that reached a CMS, or is queued to, is immovable — see rule 1.
 *
 * 'approved' is in here because that is the push RETRY QUEUE: a human approved it and the
 * push failed, so the cron will publish it within two hours. Moving its date mid-flight means
 * the article lands on the site under a date the calendar no longer shows.
 */
function isLive(p: PostRow): boolean {
  return Boolean(p.wp_post_id || p.bc_post_id)
    || p.status === 'published'
    || p.status === 'approved'
}

/** Statuses that hold a slot but are not content anyone is waiting to publish. */
const NOT_SCHEDULABLE = new Set(['rejected', 'discarded', 'generating'])

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as {
    client_id?: string
    start_date?: string
    /** Restrict the move to these posts. Omitted = every movable post. */
    post_ids?: string[]
    dry_run?: boolean
  }

  const clientId  = body.client_id
  const startDate = body.start_date
  if (!clientId || !startDate) {
    return NextResponse.json({ error: 'client_id and start_date are required' }, { status: 400 })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return NextResponse.json({ error: 'start_date must be YYYY-MM-DD' }, { status: 400 })
  }

  const today = new Date().toISOString().slice(0, 10)
  if (startDate < today) {
    // Refused rather than clamped. Generation clamps a past date to today, so accepting one
    // here would silently stack every rescheduled post onto the same day.
    return NextResponse.json(
      { error: 'Pick a start date from today onward - earlier dates cannot be published to.' },
      { status: 400 },
    )
  }

  const db = createAdminClient()

  const { data: settings } = await db
    .from('content_settings')
    .select('schedule_frequency, schedule_day_of_week, monthly_publish_day')
    .eq('client_id', clientId)
    .maybeSingle()

  const frequency = (settings?.schedule_frequency as string | null) ?? 'weekly'
  const dayOfWeek = (settings?.schedule_day_of_week as number | null) ?? 1
  const monthDay  = (settings?.monthly_publish_day as number | null) ?? null

  const { data: postRows, error: postErr } = await db
    .from('content_posts')
    .select('id, title, topic_id, target_publish_date, status, content_type, wp_post_id, bc_post_id')
    .eq('client_id', clientId)
    .is('archived_at', null)
    // Blog content only. Service-area pages run on their own cadence out of
    // service_area_settings, so sweeping them onto the blog schedule would move pages the
    // blog anchor was never meant to govern.
    .or('content_type.is.null,content_type.eq.blog')
    .order('target_publish_date', { ascending: true, nullsFirst: false })

  if (postErr) return NextResponse.json({ error: postErr.message }, { status: 500 })

  const all = (postRows ?? []) as PostRow[]

  const skipped = all.filter(isLive).map(p => ({
    id:     p.id,
    title:  p.title,
    date:   p.target_publish_date,
    reason: 'Already on the site',
  }))

  // Rejected and generating rows are excluded because they are not going to be published:
  // leaving them in meant each one CONSUMED a cadence date and pushed every real article one
  // slot later, so a plan carrying 40 rejected posts shifted by 40 weeks.
  //
  // A post with no date is excluded too. Giving one a date does not reschedule anything — it
  // ENROLS a draft nobody scheduled into automatic publishing.
  let movable = all.filter(p =>
    !isLive(p)
    && !NOT_SCHEDULABLE.has(p.status)
    && p.target_publish_date !== null)
  if (Array.isArray(body.post_ids) && body.post_ids.length > 0) {
    const wanted = new Set(body.post_ids)
    movable = movable.filter(p => wanted.has(p.id))
  }

  // Dates ALREADY SPOKEN FOR by rows this reschedule is not moving — live posts, rejected
  // ones, service-area pages, and anything the caller did not select. Landing a moved post on
  // one of those puts two articles on the same day, which the calendar renders as a duplicate.
  const taken = new Set(
    all
      .filter(p => !movable.some(m => m.id === p.id))
      .map(p => p.target_publish_date)
      .filter((d) => !!d),
  )

  // Over-generate, then drop collisions, so the tail is not stranded when dates are skipped.
  // The cadence is preserved: skipping a taken date moves that post to the NEXT cadence date
  // rather than to an arbitrary gap.
  const dates = cadenceDates(startDate, frequency, dayOfWeek, monthDay, movable.length + taken.size)
    .filter(d => !taken.has(d))
    .slice(0, movable.length)

  const plan = movable
    .map((p, i) => ({
      id:      p.id,
      title:   p.title,
      topicId: p.topic_id,
      from:    p.target_publish_date,
      to:      dates[i] ?? null,
    }))
    .filter(x => x.to && x.to !== x.from)

  if (body.dry_run) {
    return NextResponse.json({ ok: true, dryRun: true, plan, skipped })
  }

  let moved = 0
  const failures = []
  const vacated = []

  for (const item of plan) {
    const { error } = await db
      .from('content_posts')
      .update({ target_publish_date: item.to })
      .eq('id', item.id)
    if (error) {
      console.error(`[calendar/reschedule] post ${item.id} not moved:`, error.message)
      failures.push({ id: item.id, title: item.title, reason: error.message })
      continue
    }

    // The topic through BOTH links, not only content_posts.topic_id.
    //
    // That column is set on roughly a quarter of rows; the reverse link
    // content_topics.post_id covers most of the rest. Resolving only the forward one left the
    // topic behind for the majority of posts — and the calendar groups by the TOPIC's date, so
    // the article silently published on a date the dashboard never displayed. This is the
    // route's central promise, and it was the half that did not hold.
    let topicErr = null
    if (item.topicId) {
      const { error: tErr } = await db
        .from('content_topics')
        .update({ target_publish_date: item.to })
        .eq('id', item.topicId)
      topicErr = tErr ? tErr.message : null
    } else {
      const { error: tErr } = await db
        .from('content_topics')
        .update({ target_publish_date: item.to })
        .eq('post_id', item.id)
      topicErr = tErr ? tErr.message : null
    }

    if (topicErr) {
      // NOT counted as moved. A post whose topic stayed behind is the desynchronised state
      // this route exists to prevent, so reporting it as success would hide the one failure
      // that matters.
      console.error(`[calendar/reschedule] topic for post ${item.id} not moved:`, topicErr)
      failures.push({ id: item.id, title: item.title, reason: 'Post moved but its topic did not: ' + topicErr })
      continue
    }

    moved++
    if (item.from) vacated.push({ client_id: clientId, target_publish_date: item.from })
  }

  // Suppress the dates we emptied, or the cron refills them within two hours and the client
  // receives a second article on every date the reschedule moved away from. Dates now occupied
  // by a moved post are excluded — those are not empty.
  const stillEmpty = vacated.filter(v => !plan.some(x => x.to === v.target_publish_date))
  if (stillEmpty.length > 0) await suppressSlots(db, stillEmpty, 'calendar reschedule')

  logActivity(await getAdminSession(), 'rescheduled', 'calendar', {
    clientId,
    meta: { startDate, moved, skipped: skipped.length },
  })

  return NextResponse.json({ ok: true, moved, skipped, failures, plan })
}

/**
 * `count` publish dates on the client's cadence, starting at or after `startDate`.
 *
 * Mirrors computeSlots in calendar/generate rather than importing it, because that one is
 * bounded by a weeks-ahead window while this needs exactly as many dates as there are posts
 * to place - a long plan must not run out of slots halfway and strand the tail.
 */
function cadenceDates(
  startDate: string,
  frequency: string,
  dayOfWeek: number,
  monthlyPublishDay: number | null,
  count: number,
): string[] {
  if (count <= 0) return []
  const iso   = (d: Date) => d.toISOString().slice(0, 10)
  const out: string[] = []
  const start = new Date(startDate + 'T00:00:00Z')

  if (frequency.startsWith('monthly')) {
    // The named monthly frequencies pin a DAY, and ignoring that was the bug: a
    // monthly_mid plan rescheduled from the 3rd would have landed every post on the 3rd,
    // permanently off the cadence the cron generates on — so the cron would keep filling the
    // 15th as an empty slot and the client would receive two posts a month, forever.
    //
    // Same mapping and the same 28-for-month-end as calendar/generate, which took it from the
    // cron. Three copies of this arithmetic is two too many, but making them agree is the
    // fix that matters here; unifying them is a refactor of the cron's own slot maths.
    const day = frequency === 'monthly_first' ? 1
              : frequency === 'monthly_mid'   ? 15
              : frequency === 'monthly_end'   ? 28
              : (monthlyPublishDay ?? start.getUTCDate())
    const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))
    // Guarded rather than while(true): a bad cadence must not spin forever on a request.
    for (let guard = 0; guard < count + 24 && out.length < count; guard++) {
      const dim = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0)).getUTCDate()
      const d   = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), Math.min(day, dim)))
      if (iso(d) >= startDate) out.push(iso(d))
      cur.setUTCMonth(cur.getUTCMonth() + 1)
    }
    return out
  }

  const stepDays = frequency === 'daily' ? 1 : frequency === 'biweekly' ? 14 : 7
  const cur = new Date(start)
  if (stepDays >= 7) {
    // Land on the client's configured weekday before stepping.
    const shift = (dayOfWeek - cur.getUTCDay() + 7) % 7
    cur.setUTCDate(cur.getUTCDate() + shift)
  }
  while (out.length < count) {
    out.push(iso(cur))
    cur.setUTCDate(cur.getUTCDate() + stepDays)
  }
  return out
}
