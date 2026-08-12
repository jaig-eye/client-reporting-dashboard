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
    .select('url, title, is_priority, is_excluded, is_service_page')
    .eq('client_id', clientId)
    .order('url')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(
    (data ?? []).map((p: { url: string; title: string | null; is_priority: boolean; is_excluded: boolean; is_service_page: boolean | null }) => ({
      url:           p.url,
      title:         p.title,
      isPriority:    p.is_priority,
      isExcluded:    p.is_excluded,
      isServicePage: p.is_service_page ?? false,
    }))
  )
}

export async function PATCH(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    client_id:      string
    url?:           string
    urls?:          string[]
    is_priority?:   boolean
    is_excluded?:   boolean
    is_service_page?: boolean
  }

  // ── Bulk path: apply the same flag to many URLs at once (e.g. exclude all blogs)
  if (Array.isArray(body.urls)) {
    if (!body.client_id) return NextResponse.json({ error: 'Missing client_id' }, { status: 400 })
    const MAX_BULK = 2000
    // Dedupe (a repeated URL makes ON CONFLICT DO UPDATE fail the whole batch) and cap
    // to keep the single upsert within Postgres' statement timeout / body limits.
    const urls = Array.from(new Set(
      body.urls.filter(u => typeof u === 'string' && u.trim()).map(u => u.trim())
    )).slice(0, MAX_BULK)
    if (urls.length === 0) return NextResponse.json({ ok: true, updated: 0 })
    // Coerce flags to real booleans (a stray non-boolean would otherwise reach Postgres).
    const priority = body.is_priority     !== undefined ? Boolean(body.is_priority)     : undefined
    const excluded = body.is_excluded     !== undefined ? Boolean(body.is_excluded)     : undefined
    const service  = body.is_service_page !== undefined ? Boolean(body.is_service_page) : undefined
    const rows = urls.map(url => {
      const row: Record<string, unknown> = { client_id: body.client_id, url }
      if (priority !== undefined) row.is_priority     = priority
      if (excluded !== undefined) row.is_excluded     = excluded
      if (service  !== undefined) row.is_service_page = service
      return row
    })
    const db = createAdminClient()
    const { error } = await db
      .from('content_sitemap_pages')
      .upsert(rows, { onConflict: 'client_id,url' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, updated: rows.length })
  }

  if (!body.client_id || !body.url) {
    return NextResponse.json({ error: 'Missing client_id or url' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {
    client_id: body.client_id,
    url:       body.url,
  }
  if (body.is_priority    !== undefined) patch.is_priority    = body.is_priority
  if (body.is_excluded    !== undefined) patch.is_excluded    = body.is_excluded
  if (body.is_service_page !== undefined) patch.is_service_page = body.is_service_page

  const db = createAdminClient()
  const { error } = await db
    .from('content_sitemap_pages')
    .upsert(patch, { onConflict: 'client_id,url' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
