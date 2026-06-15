import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { isAdminAuthed } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const page = parseInt(new URL(request.url).searchParams.get('page') ?? '0', 10)
  const from = page * PAGE_SIZE
  const to   = from + PAGE_SIZE - 1

  const db = createAdminClient()
  const [checksRes, incidentsRes, dailyRes] = await Promise.all([
    db.from('site_checks')
      .select('id, checked_at, is_up, status_code, response_ms, error')
      .eq('site_id', params.id)
      .order('checked_at', { ascending: false })
      .range(from, to),
    db.from('site_incidents')
      .select('id, started_at, ended_at, duration_s, cause')
      .eq('site_id', params.id)
      .order('started_at', { ascending: false })
      .limit(25),
    db.from('site_check_daily')
      .select('date, uptime_pct, avg_response_ms, check_count, incident_count')
      .eq('site_id', params.id)
      .order('date', { ascending: false })
      .limit(30),
  ])

  return NextResponse.json({
    checks:    checksRes.data    ?? [],
    incidents: incidentsRes.data ?? [],
    daily:     dailyRes.data     ?? [],
    nextPage:  (checksRes.data?.length ?? 0) === PAGE_SIZE ? page + 1 : null,
  })
}
