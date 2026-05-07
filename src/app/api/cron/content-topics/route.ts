// GET /api/cron/content-topics
// Daily cron (7 AM UTC) that drives automated content scheduling.
//
// Topic generation timing is automatic based on frequency × weeks_ahead:
//   weekly  + weeks_ahead=1 → topics generated 7 days before publish
//   weekly  + weeks_ahead=2 → topics maintained for both upcoming slots (14-day window)
//   monthly + weeks_ahead=1 → topics generated 28 days before publish
//
// As each slot publishes, the next slot enters the window and is automatically covered.
// No manual "lead days" setting required.

export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCycleDays(frequency: string): number {
  switch (frequency) {
    case 'monthly': case 'monthly_first': case 'monthly_mid': case 'monthly_end': return 28
    case 'biweekly': return 14
    case 'weekly':   return 7
    default:         return 1
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getDate()
}

// Returns future publish date strings (YYYY-MM-DD) within the next weeksLookahead weeks
function computeFutureSlots(frequency: string, dayOfWeek: number, weeksLookahead: number): string[] {
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
                    : now.getUTCDate()
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

// ── Cron handler ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  // Load all clients with auto_generate enabled
  const { data: settingsRows } = await db
    .from('content_settings')
    .select('client_id, schedule_frequency, schedule_day_of_week, topics_per_run, posts_per_run, weeks_ahead')
    .eq('auto_generate', true)
    .not('client_id', 'is', null)

  if (!settingsRows || settingsRows.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'No clients with auto_generate enabled' })
  }

  // Global fallback schedule
  const { data: globalSettings } = await db
    .from('content_settings')
    .select('schedule_frequency, schedule_day_of_week')
    .is('client_id', null)
    .maybeSingle()

  const globalFreq = (globalSettings as { schedule_frequency?: string } | null)?.schedule_frequency ?? 'weekly'
  const globalDay  = (globalSettings as { schedule_day_of_week?: number } | null)?.schedule_day_of_week ?? 1

  // Reset topics stuck in 'generating' for more than 1 hour (timed out or crashed)
  await db
    .from('content_topics')
    .update({ status: 'scheduled', generation_error: 'Timed out — reset by cron' })
    .eq('status', 'generating')
    .lt('updated_at', new Date(Date.now() - 3_600_000).toISOString())

  const topicsGenerated: string[] = []
  const briefsGenerated: string[] = []
  const postsTriggered:  string[] = []

  for (const row of settingsRows) {
    const {
      client_id,
      schedule_frequency,
      schedule_day_of_week,
      topics_per_run = 5,
      weeks_ahead    = 1,
    } = row as {
      client_id:            string
      schedule_frequency:   string | null
      schedule_day_of_week: number | null
      topics_per_run:       number
      posts_per_run:        number
      weeks_ahead:          number
    }

    const frequency = (schedule_frequency as string | null) ?? globalFreq
    const dayOfWeek = (schedule_day_of_week as number | null) ?? globalDay

    // Lead window = one cycle × weeks_ahead
    // weekly + 2 weeks ahead → 14-day window (always maintain 2 slots covered)
    const cycle      = getCycleDays(frequency)
    const leadWindow = cycle * Math.max(weeks_ahead, 1)
    // Scan slightly further than leadWindow so slots just entering the window are caught
    const weeksToScan = Math.ceil(leadWindow / 7) + 1

    const slots = computeFutureSlots(frequency, dayOfWeek, weeksToScan).filter(slot => {
      const ms = new Date(slot + 'T00:00:00Z').getTime() - Date.now()
      const d  = Math.round(ms / 86_400_000)
      return d > 0 && d <= leadWindow
    })

    // ── Topic generation: cover every slot in the lead window ─────────────
    for (const slot of slots) {
      const { data: existing } = await db
        .from('content_topics')
        .select('id')
        .eq('client_id', client_id)
        .eq('target_publish_date', slot)
        .in('status', ['pending', 'approved', 'generating', 'generated', 'scheduled'])
        .limit(1)

      if (existing && existing.length > 0) continue

      try {
        const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
        await fetch(`${appUrl}/api/admin/content/topics/generate`, {
          method:  'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': `admin_session=${process.env.ADMIN_PASSWORD}`,
          },
          body: JSON.stringify({ client_id, count: topics_per_run, target_publish_date: slot }),
        })
        topicsGenerated.push(`${client_id}:${slot}`)
      } catch (e) {
        console.error(`[content-topics cron] Topic generation failed for client ${client_id} slot ${slot}:`, e)
      }
    }

    // ── SEO briefs: generate for approved topics that don't have one yet ──
    const { data: brieflessTopics } = await db
      .from('content_topics')
      .select('id')
      .eq('client_id', client_id)
      .in('status', ['approved', 'scheduled'])
      .is('seo_brief', null)

    await Promise.allSettled((brieflessTopics ?? []).map(async (topic) => {
      try {
        const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
        const res = await fetch(`${appUrl}/api/admin/content/topics/${topic.id}/brief`, {
          method:  'POST',
          headers: { 'Cookie': `admin_session=${process.env.ADMIN_PASSWORD}` },
        })
        if (res.ok) briefsGenerated.push(topic.id)
      } catch (e) {
        console.error(`[content-topics cron] Brief generation failed for topic ${topic.id}:`, e)
      }
    }))

    // ── Post generation: fire for all approved/scheduled topics ───────────
    const { data: approvedTopics } = await db
      .from('content_topics')
      .select('id')
      .eq('client_id', client_id)
      .in('status', ['scheduled', 'approved'])

    await Promise.allSettled((approvedTopics ?? []).map(async (topic) => {
      try {
        const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
        await db.from('content_topics').update({ status: 'generating' }).eq('id', topic.id)
        const res = await fetch(`${appUrl}/api/admin/content/generate`, {
          method:  'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': `admin_session=${process.env.ADMIN_PASSWORD}`,
          },
          body: JSON.stringify({ topic_id: topic.id }),
        })
        if (!res.ok) throw new Error(await res.text())
        postsTriggered.push(topic.id)
      } catch (e) {
        console.error(`[content-topics cron] Post generation failed for topic ${topic.id}:`, e)
        await db.from('content_topics')
          .update({ status: 'scheduled', generation_error: String(e) })
          .eq('id', topic.id)
      }
    }))
  }

  console.log(`[content-topics cron] slots covered: ${topicsGenerated.length}, ${briefsGenerated.length} briefs, ${postsTriggered.length} posts triggered`)

  return NextResponse.json({
    ok:              true,
    topicsGenerated: topicsGenerated.length,
    briefsGenerated: briefsGenerated.length,
    postsTriggered:  postsTriggered.length,
  })
}
