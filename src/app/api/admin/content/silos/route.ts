// GET  /api/admin/content/silos?client_id=X  — list silos with cluster counts
// POST /api/admin/content/silos              — create silo
// PATCH /api/admin/content/silos?id=X        — update silo fields
// DELETE /api/admin/content/silos?id=X       — archive silo

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

type ClusterKeyword = {
  id: string
  keyword: string
  title?: string | null
  status: 'planned' | 'published'
  priority: number
}

type SiloRow = {
  id: string
  client_id: string
  name: string
  hub_page_url: string | null
  hub_page_title: string | null
  central_entity: string | null
  description: string | null
  section: string
  status: string
  content_type: string
  target_keyword: string | null
  cluster_keywords: ClusterKeyword[]
  target_exists: boolean
  priority: number
  pending_links: Array<{ post_id?: string; url?: string; title: string; added_at: string }>
  created_at: string
}

const VALID_CONTENT_TYPES = ['blog', 'service_page', 'regular_page'] as const

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId = request.nextUrl.searchParams.get('client_id')
  if (!clientId) return NextResponse.json({ error: 'Missing client_id' }, { status: 400 })

  const db = createAdminClient()

  const contentType = request.nextUrl.searchParams.get('content_type')

  let query = db
    .from('content_silos')
    .select('*')
    .eq('client_id', clientId)
    .neq('status', 'archived')
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })

  if (contentType && VALID_CONTENT_TYPES.includes(contentType as typeof VALID_CONTENT_TYPES[number])) {
    query = query.eq('content_type', contentType)
  }

  const { data: silos, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Attach cluster counts per silo
  const siloIds = (silos ?? []).map((s: SiloRow) => s.id)
  let counts: Record<string, { published: number; total: number }> = {}

  if (siloIds.length > 0) {
    const { data: posts } = await db
      .from('content_posts')
      .select('silo_id, status')
      .in('silo_id', siloIds)

    for (const post of posts ?? []) {
      const sid = post.silo_id as string
      if (!counts[sid]) counts[sid] = { published: 0, total: 0 }
      counts[sid].total++
      if (post.status === 'draft_saved' || post.status === 'published') {
        counts[sid].published++
      }
    }
  }

  const result = (silos ?? []).map((s: SiloRow) => ({
    ...s,
    clusterCount: counts[s.id]?.total ?? 0,
    publishedCount: counts[s.id]?.published ?? 0,
  }))

  return NextResponse.json({ silos: result })
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    client_id: string
    name: string
    hub_page_url?: string | null
    hub_page_title?: string | null
    central_entity?: string | null
    description?: string | null
    section?: string
    content_type?: string
    target_keyword?: string | null
    cluster_keywords?: ClusterKeyword[]
    target_exists?: boolean
    priority?: number
  }

  if (!body.client_id || !body.name)
    return NextResponse.json({ error: 'Missing client_id or name' }, { status: 400 })

  if (body.content_type && !VALID_CONTENT_TYPES.includes(body.content_type as typeof VALID_CONTENT_TYPES[number]))
    return NextResponse.json({ error: `Invalid content_type. Must be one of: ${VALID_CONTENT_TYPES.join(', ')}` }, { status: 400 })

  const db = createAdminClient()
  const { data, error } = await db
    .from('content_silos')
    .insert({
      client_id:        body.client_id,
      name:             body.name.trim(),
      hub_page_url:     body.hub_page_url     ?? null,
      hub_page_title:   body.hub_page_title   ?? null,
      central_entity:   body.central_entity   ?? null,
      description:      body.description      ?? null,
      section:          body.section          ?? 'core',
      content_type:     body.content_type     ?? 'blog',
      target_keyword:   body.target_keyword   ?? null,
      cluster_keywords: body.cluster_keywords ?? [],
      target_exists:    body.target_exists    ?? true,
      priority:         body.priority         ?? 100,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ silo: data })
}

export async function PATCH(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const body = await request.json() as Partial<{
    name: string
    hub_page_url: string | null
    hub_page_title: string | null
    central_entity: string | null
    description: string | null
    section: string
    status: string
    content_type: string
    target_keyword: string | null
    cluster_keywords: ClusterKeyword[]
    target_exists: boolean
    priority: number
    pending_links: unknown[]
  }>

  if (body.content_type && !VALID_CONTENT_TYPES.includes(body.content_type as typeof VALID_CONTENT_TYPES[number]))
    return NextResponse.json({ error: `Invalid content_type. Must be one of: ${VALID_CONTENT_TYPES.join(', ')}` }, { status: 400 })

  // Validate cluster_keywords shape — each keyword string is sanitized to prevent prompt injection
  if (body.cluster_keywords !== undefined) {
    if (!Array.isArray(body.cluster_keywords))
      return NextResponse.json({ error: 'cluster_keywords must be an array' }, { status: 400 })
    body.cluster_keywords = (body.cluster_keywords as ClusterKeyword[]).map(k => ({
      ...k,
      keyword: String(k.keyword ?? '').replace(/[\r\n"\\]/g, ' ').trim().slice(0, 200),
    }))
  }

  // pending_links is written atomically via the append_silo_pending_link RPC.
  // Direct PATCH is allowed only for clearing/editing the array (admin use); validate shape.
  if (body.pending_links !== undefined) {
    if (!Array.isArray(body.pending_links))
      return NextResponse.json({ error: 'pending_links must be an array' }, { status: 400 })
    for (const item of body.pending_links as unknown[]) {
      if (typeof item !== 'object' || item === null || typeof (item as Record<string, unknown>).title !== 'string')
        return NextResponse.json({ error: 'Each pending_links entry must have a string title' }, { status: 400 })
    }
  }

  // pending_links writes go through the append_silo_pending_link RPC for atomic appends.
  // Direct PATCH of pending_links is intentionally excluded to prevent races.
  const allowed = ['name', 'hub_page_url', 'hub_page_title', 'central_entity', 'description', 'section', 'status',
    'content_type', 'target_keyword', 'cluster_keywords', 'target_exists', 'priority']
  const update: Record<string, unknown> = {}
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      update[key] = (body as Record<string, unknown>)[key]
    }
  }

  if (Object.keys(update).length === 0)
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

  const db = createAdminClient()
  const { error } = await db.from('content_silos').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const db = createAdminClient()
  const { error } = await db.from('content_silos').update({ status: 'archived' }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
