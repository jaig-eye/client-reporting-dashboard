// GET  /api/admin/content/silos/[siloId]/keywords — list keywords for a silo
// POST /api/admin/content/silos/[siloId]/keywords — add one keyword ({ keyword, ... }) or many
//   ({ keywords: string[] }), appended to the end of the queue

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import { cleanQueueKeyword, cleanQueueKeywords } from '@/lib/content/siloQueue'

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
    /** Ignored: the silo decides the client. Accepted so older callers keep working. */
    client_id?:              string
    keyword?:                string
    /** Many at once, in order, one keyword each. */
    keywords?:               unknown[]
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

  const db = createAdminClient()

  // The silo decides the client. Taking client_id from the body could file a keyword under a
  // client other than the silo's, where no generation run would ever look for it.
  const { data: silo, error: siloErr } = await db
    .from('content_silos')
    .select('client_id')
    .eq('id', siloId)
    .maybeSingle()
  if (siloErr) return NextResponse.json({ error: siloErr.message }, { status: 500 })
  if (!silo) return NextResponse.json({ error: 'Silo not found' }, { status: 404 })
  const clientId = (silo as { client_id: string }).client_id

  // What the silo already holds: to skip repeats, and to append after the last keyword. Every
  // added keyword used to get sort_order 0, which sorted it AHEAD of a queue seeded 0, 1, 2… — a
  // keyword added later was written before the ones waiting longest.
  const { data: existing, error: exErr } = await db
    .from('content_silo_keywords')
    .select('keyword, sort_order')
    .eq('silo_id', siloId)
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 })
  const held = (existing ?? []) as { keyword: string; sort_order: number | null }[]
  const have = new Set(held.map(k => cleanQueueKeyword(k.keyword).toLowerCase()))
  const nextOrder = held.reduce((m, k) => Math.max(m, k.sort_order ?? 0), -1) + 1

  if (Array.isArray(body.keywords)) {
    const list  = cleanQueueKeywords(body.keywords).slice(0, 200)
    const fresh = list.filter(k => !have.has(k.toLowerCase()))
    if (fresh.length === 0) return NextResponse.json({ added: 0, skipped: list.length, keywords: [] })
    const { data, error } = await db
      .from('content_silo_keywords')
      .insert(fresh.map((keyword, i) => ({
        client_id:    clientId,
        silo_id:      siloId,
        keyword,
        keyword_type: 'supporting',
        sort_order:   nextOrder + i,
        selected:     true,
      })))
      .select()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ added: fresh.length, skipped: list.length - fresh.length, keywords: data ?? [] }, { status: 201 })
  }

  const keyword = cleanQueueKeyword(body.keyword)
  if (!keyword) return NextResponse.json({ error: 'Missing keyword' }, { status: 400 })
  if (have.has(keyword.toLowerCase()))
    return NextResponse.json({ error: `"${keyword}" is already in this silo` }, { status: 409 })

  const validTypes = ['top_level', 'secondary_top_level', 'supporting']
  const kwType = validTypes.includes(body.keyword_type ?? '') ? body.keyword_type : 'supporting'

  const { data, error } = await db
    .from('content_silo_keywords')
    .insert({
      client_id:               clientId,
      silo_id:                 siloId,
      keyword,
      sort_order:              nextOrder,
      keyword_type:            kwType,
      intent:                  body.intent                  ?? null,
      monthly_searches_low:    body.monthly_searches_low    ?? null,
      monthly_searches_high:   body.monthly_searches_high   ?? null,
      keyword_score:           body.keyword_score           ?? null,
      trust_authority_score:   body.trust_authority_score   ?? null,
      current_ranking_url:     body.current_ranking_url     ?? null,
      current_ranking_position: body.current_ranking_position ?? null,
      // Default TRUE, not false. `selected` is what the hub-less keyword queue
      // means by "available" (see fetchQueueKeywords and the silo card's
      // "N of M left" count), and this is the only in-app way to add a keyword to
      // an existing silo — the detail page's add box sends no `selected` at all.
      // Defaulting to false made every keyword typed there invisible: never
      // queued, never counted, never generated from, and no error anywhere.
      selected:                body.selected                ?? true,
      page_category:           body.page_category           ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ keyword: data }, { status: 201 })
}
