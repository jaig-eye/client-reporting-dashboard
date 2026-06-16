// GET /api/admin/content/optimization/audits/[auditId] — fetch stored audit

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

export async function GET(
  _request: NextRequest,
  { params }: { params: { auditId: string } }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { auditId } = params
  const db = createAdminClient()

  const { data, error } = await db
    .from('content_optimization_audits')
    .select('*')
    .eq('id', auditId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  return NextResponse.json({ audit: data })
}
