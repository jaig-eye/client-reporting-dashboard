// GET/PUT /api/admin/content/service-area-settings?client_id=X
// Manages service_area_settings for a client.

import { NextRequest, NextResponse } from 'next/server'
import { cookies }                   from 'next/headers'
import { createAdminClient }         from '@/lib/supabase/server'
import { isAdminAuthed }             from '@/lib/auth'

const ALLOWED = [
  'connection_id', 'slug_structure', 'service_pages', 'service_areas',
  'nearby_areas_template', 'primary_service',
  'auto_generate', 'auto_approve_pages', 'auto_push_pages',
  'wp_publish_mode', 'schedule_frequency', 'schedule_day_of_week',
  'pages_per_run', 'publish_time',
  'target_length', 'page_structure', 'location_notes', 'tone_notes',
  'use_gsc_discovery', 'min_gsc_impressions', 'check_sitemap_overlap',
  'default_author_id',
  'base_page_path', 'city_slug_format',
]

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const clientId = new URL(request.url).searchParams.get('client_id')
  if (!clientId) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

  const db = createAdminClient()
  const { data } = await db
    .from('service_area_settings')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle()

  return NextResponse.json(data ?? {})
}

export async function PUT(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const clientId = new URL(request.url).searchParams.get('client_id')
  if (!clientId) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

  const body = await request.json() as Record<string, unknown>
  const patch: Record<string, unknown> = { client_id: clientId, updated_at: new Date().toISOString() }
  for (const key of ALLOWED) {
    if (body[key] !== undefined) patch[key] = body[key]
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('service_area_settings')
    .upsert(patch, { onConflict: 'client_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
