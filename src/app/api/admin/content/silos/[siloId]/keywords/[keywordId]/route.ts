// PATCH  /api/admin/content/silos/[siloId]/keywords/[keywordId] — update keyword
// DELETE /api/admin/content/silos/[siloId]/keywords/[keywordId] — delete keyword

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { siloId: string; keywordId: string } }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { keywordId } = params
  const body = await request.json() as Partial<{
    keyword: string
    keyword_type: string
    intent: string | null
    monthly_searches_low: number | null
    monthly_searches_high: number | null
    keyword_score: number | null
    trust_authority_score: number | null
    current_ranking_url: string | null
    current_ranking_position: number | null
    selected: boolean
    page_category: string | null
    target_post_id: string | null
  }>

  const allowed = [
    'keyword', 'keyword_type', 'intent', 'monthly_searches_low', 'monthly_searches_high',
    'keyword_score', 'trust_authority_score', 'current_ranking_url', 'current_ranking_position',
    'selected', 'page_category', 'target_post_id',
  ]
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      update[key] = (body as Record<string, unknown>)[key]
    }
  }

  const db = createAdminClient()
  const { error } = await db.from('content_silo_keywords').update(update).eq('id', keywordId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { siloId: string; keywordId: string } }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { keywordId } = params
  const db = createAdminClient()
  const { error } = await db.from('content_silo_keywords').delete().eq('id', keywordId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
