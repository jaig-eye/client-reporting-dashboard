// GET /api/admin/content/sitemap-pages?client_id=X — list pages
// PATCH /api/admin/content/sitemap-pages — toggle is_priority or is_excluded

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient }         from '@/lib/supabase/server'
import { isAdminAuthed }             from '@/lib/auth'

export async function GET(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId = request.nextUrl.searchParams.get('client_id')
  if (!clientId) return NextResponse.json({ error: 'Missing client_id' }, { status: 400 })

  const db = createAdminClient()
  const { data, error } = await db
    .from('content_sitemap_pages')
    .select('url, title, is_priority, is_excluded')
    .eq('client_id', clientId)
    .order('url')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(
    (data ?? []).map((p: { url: string; title: string | null; is_priority: boolean; is_excluded: boolean }) => ({
      url:        p.url,
      title:      p.title,
      isPriority: p.is_priority,
      isExcluded: p.is_excluded,
    }))
  )
}

export async function PATCH(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    client_id:   string
    url:         string
    is_priority?: boolean
    is_excluded?: boolean
  }

  if (!body.client_id || !body.url) {
    return NextResponse.json({ error: 'Missing client_id or url' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {
    client_id: body.client_id,
    url:       body.url,
  }
  if (body.is_priority !== undefined) patch.is_priority = body.is_priority
  if (body.is_excluded  !== undefined) patch.is_excluded  = body.is_excluded

  const db = createAdminClient()
  const { error } = await db
    .from('content_sitemap_pages')
    .upsert(patch, { onConflict: 'client_id,url' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
