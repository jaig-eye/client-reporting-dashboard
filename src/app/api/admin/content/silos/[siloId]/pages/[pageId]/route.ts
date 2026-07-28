// PATCH  /api/admin/content/silos/[siloId]/pages/[pageId] — update page
// DELETE /api/admin/content/silos/[siloId]/pages/[pageId] — archive page

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { siloId: string; pageId: string } }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { siloId, pageId } = params
  const body = await request.json() as Partial<{
    title: string
    slug: string | null
    page_type: string
    status: string
    target_url: string | null
    content_topic_id: string | null
    content_post_id: string | null
    primary_keyword_id: string | null
    priority: number
    sort_order: number
  }>

  const allowed = [
    'title', 'slug', 'page_type', 'status', 'target_url',
    'content_topic_id', 'content_post_id', 'primary_keyword_id',
    'priority', 'sort_order',
  ]
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      update[key] = (body as Record<string, unknown>)[key]
    }
  }

  const db = createAdminClient()
  const { error } = await db.from('content_silo_pages').update(update).eq('id', pageId).eq('silo_id', siloId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { siloId: string; pageId: string } }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { siloId, pageId } = params
  const db = createAdminClient()
  const { error } = await db.from('content_silo_pages').update({ status: 'archived', updated_at: new Date().toISOString() }).eq('id', pageId).eq('silo_id', siloId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
