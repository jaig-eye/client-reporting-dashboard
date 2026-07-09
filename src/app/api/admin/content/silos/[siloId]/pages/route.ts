// GET  /api/admin/content/silos/[siloId]/pages — list planned pages
// POST /api/admin/content/silos/[siloId]/pages — create planned page

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

export async function GET(
  request: NextRequest,
  { params }: { params: { siloId: string } }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { siloId } = params
  const db = createAdminClient()

  const { data, error } = await db
    .from('content_silo_pages')
    .select(`
      *,
      primary_keyword:content_silo_keywords(id, keyword, keyword_type),
      content_post:content_posts(id, title, status, slug)
    `)
    .eq('silo_id', siloId)
    .neq('status', 'archived')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ pages: data ?? [] })
}

export async function POST(
  request: NextRequest,
  { params }: { params: { siloId: string } }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { siloId } = params
  const body = await request.json() as {
    client_id:           string
    title:               string
    slug?:               string | null
    page_type?:          string
    primary_keyword_id?: string | null
    priority?:           number
    sort_order?:         number
    target_url?:         string | null
  }

  if (!body.client_id || !body.title?.trim())
    return NextResponse.json({ error: 'Missing client_id or title' }, { status: 400 })

  const validTypes = ['hub', 'supporting_article', 'service_area', 'comparison', 'guide', 'faq', 'commercial', 'other']
  const pageType = validTypes.includes(body.page_type ?? '') ? body.page_type : 'supporting_article'

  const db = createAdminClient()
  const { data, error } = await db
    .from('content_silo_pages')
    .insert({
      client_id:          body.client_id,
      silo_id:            siloId,
      title:              body.title.trim(),
      slug:               body.slug              ?? null,
      page_type:          pageType,
      status:             'planned',
      primary_keyword_id: body.primary_keyword_id ?? null,
      priority:           body.priority           ?? 0,
      sort_order:         body.sort_order         ?? 0,
      target_url:         body.target_url         ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ page: data }, { status: 201 })
}
