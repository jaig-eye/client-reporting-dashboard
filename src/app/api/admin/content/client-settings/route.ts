import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed }     from '@/lib/auth'

/**
 * GET /api/admin/content/client-settings?client_id=X
 * Returns content_settings for a specific client.
 *
 * PUT /api/admin/content/client-settings
 * Body: { client_id, ...fields }
 * Upserts content_settings for the client.
 */

export async function GET(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const clientId = request.nextUrl.searchParams.get('client_id')
  if (!clientId) return NextResponse.json({ error: 'Missing client_id' }, { status: 400 })

  const db = createAdminClient()
  const { data } = await db
    .from('content_settings')
    .select('business_background, services, target_audience, geographic_focus, brand_voice, sitemap_url, post_structure, auto_generate, posts_per_run, schedule_frequency, schedule_day_of_week, target_length, connection_id, default_author_id')
    .eq('client_id', clientId)
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
    client_id,
    business_background,
    services,
    target_audience,
    geographic_focus,
    brand_voice,
    sitemap_url,
    post_structure,
    auto_generate,
    posts_per_run,
    schedule_frequency,
    schedule_day_of_week,
    target_length,
    connection_id,
    default_author_id,
  } = body as Record<string, unknown>

  if (!client_id) return NextResponse.json({ error: 'Missing client_id' }, { status: 400 })

  const db = createAdminClient()

  const { error } = await db
    .from('content_settings')
    .upsert(
      {
        client_id,
        business_background:  business_background ?? null,
        services:             services ?? null,
        target_audience:      target_audience ?? null,
        geographic_focus:     geographic_focus ?? null,
        brand_voice:          brand_voice ?? null,
        sitemap_url:          sitemap_url ?? null,
        post_structure:       post_structure ?? null,
        auto_generate:        auto_generate ?? false,
        posts_per_run:        posts_per_run ?? 1,
        schedule_frequency:   schedule_frequency ?? null,
        schedule_day_of_week: schedule_day_of_week ?? null,
        target_length:        target_length ?? null,
        connection_id:        connection_id ?? null,
        default_author_id:    default_author_id ?? null,
        updated_at:           new Date().toISOString(),
      },
      { onConflict: 'client_id', ignoreDuplicates: false }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
