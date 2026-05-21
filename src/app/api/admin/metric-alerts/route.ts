// GET /api/admin/metric-alerts?client_id=X  — list non-dismissed alerts
// POST /api/admin/metric-alerts/[id]/dismiss — handled separately

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient }         from '@/lib/supabase/server'
import { isAdminAuthed }             from '@/lib/auth'

export async function GET(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId = request.nextUrl.searchParams.get('client_id')
  const db = createAdminClient()

  let query = db
    .from('metric_alerts')
    .select('id, client_id, metric, current_val, prior_val, pct_change, direction, insight, created_at, alert_type, platform, date_label, clients(name)')
    .is('dismissed_at', null)
    .order('created_at', { ascending: false })
    .limit(50)

  if (clientId) {
    query = query.eq('client_id', clientId) as typeof query
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  type Row = {
    id: string; client_id: string; metric: string
    current_val: number; prior_val: number; pct_change: number
    direction: string; insight: string | null; created_at: string
    alert_type: string | null; platform: string | null; date_label: string | null
    clients: { name: string } | null
  }

  return NextResponse.json({
    alerts: (data ?? []).map((r: unknown) => {
      const row = r as Row
      return {
        id:          row.id,
        clientId:    row.client_id,
        clientName:  row.clients?.name ?? '',
        metric:      row.metric,
        currentVal:  row.current_val,
        priorVal:    row.prior_val,
        pctChange:   row.pct_change,
        direction:   row.direction,
        insight:     row.insight ?? '',
        createdAt:   row.created_at,
        alertType:   row.alert_type ?? 'weekly',
        platform:    row.platform ?? null,
        dateLabel:   row.date_label ?? null,
      }
    }),
  })
}
