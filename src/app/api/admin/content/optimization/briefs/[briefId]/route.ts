// GET /api/admin/content/optimization/briefs/[briefId] — fetch a stored brief

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

export async function GET(
  _request: NextRequest,
  { params }: { params: { briefId: string } }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { briefId } = params
  const db = createAdminClient()

  const { data, error } = await db
    .from('content_optimization_briefs')
    .select('*')
    .eq('id', briefId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ error: 'Brief not found' }, { status: 404 })
  return NextResponse.json({ brief: data })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { briefId: string } }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { briefId } = params
  const body = await request.json() as Record<string, unknown>

  const allowed = [
    'primary_keyword', 'secondary_keywords', 'target_location', 'competitor_urls',
    'recommended_word_count_min', 'recommended_word_count_target', 'recommended_word_count_max',
    'recommended_headings', 'required_terms', 'keyword_variations', 'lsi_terms',
    'google_entities', 'related_questions', 'schema_recommendations',
    'eeat_recommendations', 'page_structure_recommendations', 'internal_link_recommendations',
  ]
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      update[key] = body[key]
    }
  }

  if (Object.keys(update).length === 1)
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

  const db = createAdminClient()
  const { error } = await db.from('content_optimization_briefs').update(update).eq('id', briefId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
