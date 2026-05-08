// GET /api/admin/activity
// Returns paginated activity log entries.
// Query params: page (default 1), per_page (default 50), resource_type?, action?, client_id?

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sp         = request.nextUrl.searchParams
  const page       = Math.max(1, parseInt(sp.get('page')     ?? '1',  10))
  const perPage    = Math.min(100, parseInt(sp.get('per_page') ?? '50', 10))
  const resType    = sp.get('resource_type') ?? ''
  const action     = sp.get('action')        ?? ''
  const clientId   = sp.get('client_id')     ?? ''

  const db   = createAdminClient()
  let query  = db.from('activity_log').select('*', { count: 'exact' })

  if (resType)  query = query.eq('resource_type', resType)
  if (action)   query = query.eq('action',        action)
  if (clientId) query = query.eq('client_id',     clientId)

  const from = (page - 1) * perPage
  const to   = from + perPage - 1

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ logs: data ?? [], total: count ?? 0 })
}
