// GET /api/admin/sync/status?clientId=xxx&since=ISO8601
// Returns recent sync_jobs for a client, joined with connector type for labels.
// Used by ClientManualSync to poll per-source progress during an active sync.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

const SOURCE_LABELS: Record<string, string> = {
  google_ads:            'Google Ads',
  meta_ads:              'Meta Ads',
  google_search_console: 'Search Console',
  google_analytics_4:    'Google Analytics',
  google_business:       'Google Business',
  ahrefs:                'Ahrefs',
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthed(req.cookies.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const clientId = req.nextUrl.searchParams.get('clientId')
  const since    = req.nextUrl.searchParams.get('since')    // ISO8601 timestamp

  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  const db    = createAdminClient()
  const cutoff = since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: jobs, error } = await db
    .from('sync_jobs')
    .select('id, connection_id, status, records_synced, started_at, completed_at, error_message, progress_pct, progress_note, client_connections(connectors(type))')
    .eq('client_id', clientId)
    .gte('started_at', cutoff)
    .order('started_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (jobs ?? []).map((j: Record<string, unknown>) => {
    const conn    = j.client_connections as Record<string, unknown> | null
    const connector = conn?.connectors as Record<string, unknown> | null
    const type    = String(connector?.type ?? '')
    return {
      id:            j.id,
      connection_id: j.connection_id,
      source_label:  SOURCE_LABELS[type] ?? type,
      status:        j.status,
      records_synced: j.records_synced ?? 0,
      started_at:    j.started_at,
      completed_at:  j.completed_at,
      error_message: j.error_message ?? null,
      progress_pct:  (j.progress_pct as number) ?? 0,
      progress_note: (j.progress_note as string) ?? null,
    }
  })

  return NextResponse.json(rows)
}
