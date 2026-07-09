// GET /api/admin/content/silos/[siloId]/internal-links — list link recommendations

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

  const status = request.nextUrl.searchParams.get('status')

  let query = db
    .from('content_silo_internal_links')
    .select(`
      *,
      source_page:content_silo_pages!source_silo_page_id(id, title, page_type),
      target_page:content_silo_pages!target_silo_page_id(id, title, page_type)
    `)
    .eq('silo_id', siloId)
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ links: data ?? [] })
}
