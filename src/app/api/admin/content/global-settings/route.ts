import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { logActivity }                   from '@/lib/activity'

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
    .select('post_structure, auto_generate, posts_per_run, schedule_frequency, schedule_day_of_week, topics_per_run, weeks_ahead, sitemap_urls, manual_link_urls')
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
    auto_generate,
    posts_per_run,
    schedule_frequency,
    schedule_day_of_week,
    topics_per_run,
    weeks_ahead,
    sitemap_urls,
    manual_link_urls,
  } = body as {
    post_structure?:       string
    auto_generate?:        boolean
    posts_per_run?:        number
    schedule_frequency?:   string
    schedule_day_of_week?: number
    topics_per_run?:       number
    weeks_ahead?:          number
    sitemap_urls?:         string[]
    manual_link_urls?:     string[]
  }

  const db = createAdminClient()

  // Check whether a global row already exists.
  // We can't use upsert with onConflict:'client_id' because PostgreSQL treats
  // NULL != NULL, so the conflict never fires and every save inserts a new row.
  const { data: existing } = await db
    .from('content_settings')
    .select('client_id')
    .is('client_id', null)
    .maybeSingle()

  const row = {
    post_structure:       post_structure       ?? null,
    auto_generate:        auto_generate        ?? false,
    posts_per_run:        posts_per_run        ?? 1,
    schedule_frequency:   schedule_frequency   ?? 'weekly',
    schedule_day_of_week: schedule_day_of_week ?? 1,
    topics_per_run:       topics_per_run       ?? 5,
    weeks_ahead:          weeks_ahead          ?? 4,
    sitemap_urls:         Array.isArray(sitemap_urls) ? sitemap_urls : [],
    manual_link_urls:     Array.isArray(manual_link_urls) ? manual_link_urls : [],
    updated_at:           new Date().toISOString(),
  }

  const { error } = existing !== null
    ? await db.from('content_settings').update(row).is('client_id', null)
    : await db.from('content_settings').insert({ ...row, client_id: null })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const adminSession = await getAdminSession()
  logActivity(adminSession, 'updated', 'content_settings', { meta: { scope: 'global' } })
  return NextResponse.json({ ok: true })
}
