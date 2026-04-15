// GET /api/cron/content-topics
// Daily cron (7 AM UTC) that drives automated content scheduling:
//   - 30 days before monthly_publish_day: auto-generate topics for approval
//   - 7 days before: auto-generate posts for approved topics with approaching target dates
//
// Gated by: content_settings.monthly_publish_day IS NOT NULL

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

function nextOccurrence(dayOfMonth: number): Date {
  const now = new Date()
  const year  = now.getUTCFullYear()
  const month = now.getUTCMonth()
  // Try this month
  let d = new Date(Date.UTC(year, month, dayOfMonth))
  if (d <= now) {
    // Advance to next month
    d = new Date(Date.UTC(year, month + 1, dayOfMonth))
  }
  return d
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

  // Load all clients that have a monthly publish day set
  const { data: settingsRows } = await db
    .from('content_settings')
    .select('client_id, monthly_publish_day, topics_per_run, weeks_ahead')
    .not('monthly_publish_day', 'is', null)

  if (!settingsRows || settingsRows.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'No clients with monthly_publish_day set' })
  }

  // Load agency notification settings
  const { data: agencySettings } = await db
    .from('agency_settings')
    .select('notification_email, notify_schedule_generated, ai_provider, ai_model, ai_api_key, agency_name')
    .single()

  const topicsGenerated: string[] = []
  const postsTriggered:  string[] = []

  for (const row of settingsRows) {
    const {
      client_id,
      monthly_publish_day: publishDay,
      topics_per_run: topicsPerRun = 5,
    } = row as {
      client_id: string
      monthly_publish_day: number
      topics_per_run: number
      weeks_ahead: number
    }

    const nextPublish = nextOccurrence(publishDay)
    const days        = daysFromNow(nextPublish)
    const publishDateStr = nextPublish.toISOString().split('T')[0]

    // ── 30 days out: generate topics if none exist yet ─────────────────────
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
              count:               topicsPerRun,
              target_publish_date: publishDateStr,
            }),
          })
          topicsGenerated.push(client_id)
        } catch (e) {
          console.error(`Failed to generate topics for client ${client_id}:`, e)
        }
      }
    }

    // ── 7 days out: auto-generate posts for approved topics ────────────────
    if (days <= 7 && days > 0) {
      const { data: approvedTopics } = await db
        .from('content_topics')
        .select('id')
        .eq('client_id', client_id)
        .eq('target_publish_date', publishDateStr)
        .eq('status', 'approved')

      for (const topic of approvedTopics ?? []) {
        try {
          const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
          await fetch(`${appUrl}/api/admin/content/generate`, {
            method:  'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cookie': `admin_session=${process.env.ADMIN_PASSWORD}`,
            },
            body: JSON.stringify({ topic_id: topic.id }),
          })

          // Mark topic as scheduled
          await db
            .from('content_topics')
            .update({ status: 'scheduled' })
            .eq('id', topic.id)

          postsTriggered.push(topic.id)
        } catch (e) {
          console.error(`Failed to generate post for topic ${topic.id}:`, e)
        }
      }
    }
  }

  console.log(`content-topics cron: generated topics for ${topicsGenerated.length} clients, triggered ${postsTriggered.length} posts`)

  return NextResponse.json({
    ok: true,
    topicsGenerated: topicsGenerated.length,
    postsTriggered:  postsTriggered.length,
  })
}
