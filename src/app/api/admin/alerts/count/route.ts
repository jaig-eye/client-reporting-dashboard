// GET /api/admin/alerts/count — unread + non-dismissed counts by type, for sidebar pill

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

export async function GET() {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  const { data, error } = await db
    .from('admin_alerts')
    .select('type')
    .is('read_at', null)
    .is('dismissed_at', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as { type: string }[]
  const byType: Record<string, number> = { ad_insights: 0, ad_fuel: 0, content: 0, integration: 0 }
  for (const r of rows) {
    if (r.type in byType) byType[r.type]++
  }

  return NextResponse.json({ total: rows.length, byType })
}
