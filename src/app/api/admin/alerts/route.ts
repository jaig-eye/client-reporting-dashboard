// GET  /api/admin/alerts  — paginated list of non-dismissed alerts
// PATCH /api/admin/alerts  — mark alerts as read (by ids or all, optionally by type)

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db     = createAdminClient()
  const params = request.nextUrl.searchParams

  const type      = params.get('type')       || null
  const clientId  = params.get('client_id')  || null
  const unreadOnly = params.get('unread_only') === 'true'
  const limit     = Math.min(Number(params.get('limit')  ?? 100), 200)
  const offset    = Number(params.get('offset') ?? 0)

  let query = db
    .from('admin_alerts')
    .select('id, type, severity, client_id, client_name, title, body, meta, link_url, read_at, created_at')
    .is('dismissed_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (type)     query = query.eq('type', type)
  if (clientId) query = query.eq('client_id', clientId)
  if (unreadOnly) query = query.is('read_at', null)

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ alerts: data ?? [] })
}

export async function PATCH(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db   = createAdminClient()
  const body = await request.json() as { ids?: string[]; mark_all_read?: boolean; type?: string }

  const now = new Date().toISOString()

  if (body.mark_all_read) {
    let query = db
      .from('admin_alerts')
      .update({ read_at: now })
      .is('read_at', null)
      .is('dismissed_at', null)

    if (body.type) query = query.eq('type', body.type)

    const { error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (Array.isArray(body.ids) && body.ids.length > 0) {
    const { error } = await db
      .from('admin_alerts')
      .update({ read_at: now })
      .in('id', body.ids)
      .is('read_at', null)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Provide ids or mark_all_read' }, { status: 400 })
}
