// GET /api/cron/content-topics
// Daily cron (7 AM UTC) that drives automated content scheduling:
//   - 30 days before next publish date: auto-generate topics for approval
//   - 7 days before: auto-generate posts for approved topics
//
// Gated by: content_settings.auto_generate = true (all frequency types)

export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

function calcNextPublishDate(
  frequency: string,
  dayOfWeek: number,
  lastPublishedAt: string | null
): Date {
  const now = new Date()
  const y   = now.getUTCFullYear()
  const m   = now.getUTCMonth()
  const daysSinceLast = lastPublishedAt
    ? (Date.now() - new Date(lastPublishedAt).getTime()) / 86_400_000
    : Infinity

  switch (frequency) {
    case 'monthly_first': {
      const d = new Date(Date.UTC(y, m, 1))
      return d <= now ? new Date(Date.UTC(y, m + 1, 1)) : d
    }
    case 'monthly_mid': {
      const d = new Date(Date.UTC(y, m, 15))
      return d <= now ? new Date(Date.UTC(y, m + 1, 15)) : d
    }
    case 'monthly_end': {
      const d = new Date(Date.UTC(y, m, 28))
      return d <= now ? new Date(Date.UTC(y, m + 1, 28)) : d
    }
    case 'monthly':
      return new Date(Date.now() + (28 - Math.min(daysSinceLast, 28)) * 86_400_000)
    case 'biweekly':
      return new Date(Date.now() + (14 - Math.min(daysSinceLast, 14)) * 86_400_000)
    case 'weekly': {
      const daysUntil = ((dayOfWeek - now.getUTCDay()) + 7) % 7 || 7
      return new Date(Date.now() + daysUntil * 86_400_000)
    }
    default: // daily
      return new Date(Date.now() + 86_400_000)
  }
}

function daysFromNow(target: Date): number {
  return Math.round((target.getTime() - Date.now()) / 86_400_000)
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  // Load all clients with auto_generate enabled (any frequency)
  const { data: settingsRows } = await db
    .from('content_settings')
    .select('client_id, schedule_frequency, schedule_day_of_week, topics_per_run, posts_per_run, weeks_ahead')
    .eq('auto_generate', true)
    .not('client_id', 'is', null)

  if (!settingsRows || settingsRows.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'No clients with auto_generate enabled' })
  }

  // Load global fallback schedule
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
  const postsTriggered:  string[] = []

  for (const row of settingsRows) {
    const {
      client_id,
      schedule_frequency,
      schedule_day_of_week,
      topics_per_run = 5,
    } = row as {
      client_id:            string
      schedule_frequency:   string | null
      schedule_day_of_week: number | null
      topics_per_run:       number
      posts_per_run:        number
      weeks_ahead:          number
    }

    // Get last published date for this client
    const { data: lastPublish } = await db
      .from('content_posts')
      .select('generated_at')
      .eq('client_id', client_id)
      .in('status', ['published', 'approved'])
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const lastPublishedAt = (lastPublish as { generated_at: string } | null)?.generated_at ?? null

    const frequency = (schedule_frequency as string | null) ?? globalFreq
    const dayOfWeek = (schedule_day_of_week as number | null) ?? globalDay

    const nextPublish    = calcNextPublishDate(frequency, dayOfWeek, lastPublishedAt)
    const days           = daysFromNow(nextPublish)
    const publishDateStr = nextPublish.toISOString().split('T')[0]

    // ── 30 days out: generate topics if none exist for this cycle ─────────
    if (days <= 30 && days > 0) {
      const { data: existing } = await db
        .from('content_topics')
        .select('id')
        .eq('client_id', client_id)
        .eq('target_publish_date', publishDateStr)
        .in('status', ['pending', 'approved', 'generating', 'generated', 'scheduled'])
        .limit(1)

      if (!existing || existing.length === 0) {
        try {
          const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
          await fetch(`${appUrl}/api/admin/content/topics/generate`, {
            method:  'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cookie': `admin_session=${process.env.ADMIN_PASSWORD}`,
            },
            body: JSON.stringify({
              client_id,
              count:               topics_per_run,
              target_publish_date: publishDateStr,
            }),
          })
          topicsGenerated.push(client_id)
        } catch (e) {
          console.error(`[content-topics cron] Failed to generate topics for client ${client_id}:`, e)
        }
      }
    }

    // ── Always: auto-generate posts for all approved topics ──────────────
    // Run for any client with auto_generate enabled — pick up ALL approved
    // topics regardless of publish date so nothing stays stuck in queue.
    if (days <= 30) {
      const { data: approvedTopics } = await db
        .from('content_topics')
        .select('id')
        .eq('client_id', client_id)
        .in('status', ['scheduled', 'approved'])

      // Fire all generate calls concurrently so the cron doesn't time out
      // processing a long queue sequentially. Each generate call runs as its
      // own function invocation and completes independently.
      await Promise.allSettled((approvedTopics ?? []).map(async (topic) => {
        try {
          const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
          await db
            .from('content_topics')
            .update({ status: 'generating' })
            .eq('id', topic.id)
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
          console.error(`[content-topics cron] Failed to generate post for topic ${topic.id}:`, e)
          await db.from('content_topics')
            .update({ status: 'scheduled', generation_error: String(e) })
            .eq('id', topic.id)
        }
      }))
    }
  }

  console.log(`[content-topics cron] topics generated for ${topicsGenerated.length} clients, triggered ${postsTriggered.length} posts`)

  return NextResponse.json({
    ok:              true,
    topicsGenerated: topicsGenerated.length,
    postsTriggered:  postsTriggered.length,
  })
}
