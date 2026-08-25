// GET  /api/admin/content/silos/[siloId]/keywords — list keywords for a silo
// POST /api/admin/content/silos/[siloId]/keywords — create keyword

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
    .from('content_silo_keywords')
    .select('*')
    .eq('silo_id', siloId)
    .order('sort_order',  { ascending: true })
    .order('created_at',  { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const keywords = (data ?? []) as Record<string, unknown>[]

  // Attach what each keyword actually produced, so the silo can answer
  // "which article came from this term?" without an N+1 from the client.
  const postIds  = keywords.map(k => k.target_post_id).filter(Boolean) as string[]
  const topicIds = keywords.map(k => k.target_topic_id).filter(Boolean) as string[]

  const [postsRes, topicsRes] = await Promise.all([
    postIds.length
      ? db.from('content_posts').select('id, title, status, published_url, target_publish_date').in('id', postIds)
      : Promise.resolve({ data: [] }),
    topicIds.length
      ? db.from('content_topics').select('id, topic, status').in('id', topicIds)
      : Promise.resolve({ data: [] }),
  ])

  const postById  = new Map((postsRes.data  ?? []).map((p: Record<string, unknown>) => [p.id as string, p]))
  const topicById = new Map((topicsRes.data ?? []).map((t: Record<string, unknown>) => [t.id as string, t]))

  return NextResponse.json({
    keywords: keywords.map(k => ({
      ...k,
      post:  k.target_post_id  ? postById.get(k.target_post_id  as string) ?? null : null,
      topic: k.target_topic_id ? topicById.get(k.target_topic_id as string) ?? null : null,
    })),
  })
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
    client_id:               string
    keyword:                 string
    keyword_type?:           string
    intent?:                 string | null
    monthly_searches_low?:   number | null
    monthly_searches_high?:  number | null
    keyword_score?:          number | null
    trust_authority_score?:  number | null
    current_ranking_url?:    string | null
    current_ranking_position?: number | null
    selected?:               boolean
    page_category?:          string | null
  }

  if (!body.client_id || !body.keyword?.trim())
    return NextResponse.json({ error: 'Missing client_id or keyword' }, { status: 400 })

  const validTypes = ['top_level', 'secondary_top_level', 'supporting']
  const kwType = validTypes.includes(body.keyword_type ?? '') ? body.keyword_type : 'supporting'

  const db = createAdminClient()
  const { data, error } = await db
    .from('content_silo_keywords')
    .insert({
      client_id:               body.client_id,
      silo_id:                 siloId,
      keyword:                 body.keyword.trim(),
      keyword_type:            kwType,
      intent:                  body.intent                  ?? null,
      monthly_searches_low:    body.monthly_searches_low    ?? null,
      monthly_searches_high:   body.monthly_searches_high   ?? null,
      keyword_score:           body.keyword_score           ?? null,
      trust_authority_score:   body.trust_authority_score   ?? null,
      current_ranking_url:     body.current_ranking_url     ?? null,
      current_ranking_position: body.current_ranking_position ?? null,
      selected:                body.selected                ?? false,
      page_category:           body.page_category           ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ keyword: data }, { status: 201 })
}
