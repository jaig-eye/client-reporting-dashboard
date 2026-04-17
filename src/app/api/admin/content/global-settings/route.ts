import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed }     from '@/lib/auth'

/**
 * GET /api/admin/content/global-settings
 * Returns the global content_settings row (client_id IS NULL).
 *
 * PUT /api/admin/content/global-settings
 * Upserts the global content_settings row.
 */

export async function GET(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const { data } = await db
    .from('content_settings')
    .select('post_structure, auto_generate, posts_per_run, schedule_frequency, schedule_day_of_week, monthly_publish_day, topics_per_run, weeks_ahead')
    .is('client_id', null)
    .maybeSingle()

  return NextResponse.json(data ?? {})
}

export async function PUT(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const {
    post_structure,
    posts_per_run,
    schedule_frequency,
    schedule_day_of_week,
    monthly_publish_day,
    topics_per_run,
    weeks_ahead,
  } = body as {
    post_structure?:       string
    posts_per_run?:        number
    schedule_frequency?:   string
    schedule_day_of_week?: number
    monthly_publish_day?:  number | null
    topics_per_run?:       number
    weeks_ahead?:          number
  }

  const db = createAdminClient()

  const { error } = await db
    .from('content_settings')
    .upsert(
      {
        client_id:            null,
        post_structure:       post_structure ?? null,
        posts_per_run:        posts_per_run ?? 1,
        schedule_frequency:   schedule_frequency ?? 'weekly',
        schedule_day_of_week: schedule_day_of_week ?? 1,
        monthly_publish_day:  monthly_publish_day ?? null,
        topics_per_run:       topics_per_run ?? 5,
        weeks_ahead:          weeks_ahead ?? 4,
        updated_at:           new Date().toISOString(),
      },
      { onConflict: 'client_id', ignoreDuplicates: false }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
