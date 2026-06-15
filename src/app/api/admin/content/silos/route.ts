// GET  /api/admin/content/silos?client_id=X  — list silos with cluster counts
// POST /api/admin/content/silos              — create silo
// PATCH /api/admin/content/silos?id=X        — update silo fields
// DELETE /api/admin/content/silos?id=X       — archive silo

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

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
  pending_links: Array<{ url: string; title: string; anchor_suggestion: string; added_at: string }>
  created_at: string
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId = request.nextUrl.searchParams.get('client_id')
  if (!clientId) return NextResponse.json({ error: 'Missing client_id' }, { status: 400 })

  const db = createAdminClient()

  const { data: silos, error } = await db
    .from('content_silos')
    .select('*')
    .eq('client_id', clientId)
    .neq('status', 'archived')
    .order('created_at', { ascending: true })

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
  }

  if (!body.client_id || !body.name)
    return NextResponse.json({ error: 'Missing client_id or name' }, { status: 400 })

  const db = createAdminClient()
  const { data, error } = await db
    .from('content_silos')
    .insert({
      client_id:      body.client_id,
      name:           body.name.trim(),
      hub_page_url:   body.hub_page_url   ?? null,
      hub_page_title: body.hub_page_title ?? null,
      central_entity: body.central_entity ?? null,
      description:    body.description    ?? null,
      section:        body.section        ?? 'core',
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
  }>

  const allowed = ['name', 'hub_page_url', 'hub_page_title', 'central_entity', 'description', 'section', 'status']
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
