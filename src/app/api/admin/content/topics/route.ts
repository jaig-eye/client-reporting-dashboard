// GET /api/admin/content/topics?client_id=X[&status=pending]
// Lists content topics for a client.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const clientId    = searchParams.get('client_id')
  const status      = searchParams.get('status')       // optional filter
  const contentType = searchParams.get('content_type') // optional: 'blog' | 'service_area'

  if (!clientId) {
    return NextResponse.json({ error: 'client_id required' }, { status: 400 })
  }

  const db = createAdminClient()
  let query = db
    .from('content_topics')
    .select('*, post:content_posts(id, title, status, published_url)')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (status) {
    query = query.eq('status', status) as typeof query
  }

  if (contentType) {
    query = query.eq('content_type', contentType) as typeof query
  } else {
    // Default: only return blog topics (no content_type filter returns all, so explicitly filter)
    query = query.eq('content_type', 'blog') as typeof query
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as Record<string, unknown>
  const { client_id, content_type, city, state_abbr, service_name, topic, status: bodyStatus } = body

  if (!client_id || !content_type) {
    return NextResponse.json({ error: 'client_id and content_type required' }, { status: 400 })
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('content_topics')
    .insert({
      client_id,
      content_type,
      city:         city        ?? null,
      state_abbr:   state_abbr  ?? null,
      service_name: service_name ?? null,
      topic:        topic       ?? (city && service_name ? `${service_name} in ${city}, ${state_abbr}` : 'Service Area Page'),
      status:       bodyStatus  ?? 'pending',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
