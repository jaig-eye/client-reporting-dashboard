// GET /api/admin/content/topics?client_id=X[&status=pending]
// Lists content topics for a client.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('client_id')
  const status   = searchParams.get('status') // optional filter

  if (!clientId) {
    return NextResponse.json({ error: 'client_id required' }, { status: 400 })
  }

  const db = createAdminClient()
  let query = db
    .from('content_topics')
    .select('*, post:content_posts(id, title, status, published_url)')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (status) {
    query = query.eq('status', status) as typeof query
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
