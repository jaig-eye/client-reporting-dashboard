// GET  /api/admin/system/logs   — paginated sync logs
// POST /api/admin/system/logs   — clear stuck (running > 8min) jobs

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

const PER_PAGE = 50

async function cleanupStuckJobs(db: ReturnType<typeof createAdminClient>): Promise<number> {
  // 8 minutes — just above Vercel's 300s function limit. Jobs still running
  // after this are almost certainly dead (function was killed by the platform).
  const eightMinsAgo = new Date(Date.now() - 8 * 60 * 1000).toISOString()
  const { data: stuckJobs } = await db
    .from('sync_jobs')
    .select('id')
    .eq('status', 'running')
    .lt('started_at', eightMinsAgo)

  if (!stuckJobs?.length) return 0

  await db
    .from('sync_jobs')
    .update({
      status:        'error',
      error_message: 'Job timed out (stale)',
      completed_at:  new Date().toISOString(),
    })
    .in('id', stuckJobs.map(j => j.id))

  return stuckJobs.length
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthed(req.cookies.get('admin_session')?.value)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db       = createAdminClient()
  const url      = req.nextUrl
  const page     = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))
  const clientId = url.searchParams.get('client_id') ?? null
  const from     = (page - 1) * PER_PAGE
  const to       = from + PER_PAGE - 1

  // Passive cleanup: mark stale running jobs before fetching
  await cleanupStuckJobs(db)

  let query = db
    .from('sync_jobs')
    .select(`
      id, connection_id, client_id, job_type, status,
      records_synced, error_message, date_from, date_to,
      started_at, completed_at, triggered_by,
      client:clients(name),
      connection:client_connections(
        connector:connectors(type)
      )
    `, { count: 'exact' })
    .order('started_at', { ascending: false })
    .range(from, to)

  if (clientId) query = query.eq('client_id', clientId)

  const { data, error, count } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const jobs = (data ?? []).map((j: Record<string, unknown>) => {
    // Supabase PostgREST returns plain objects (not arrays) for many-to-one FK joins
    const client     = j.client     as { name: string } | null
    const connection = j.connection as { connector: { type: string } | null } | null

    return {
      id:             j.id,
      connection_id:  j.connection_id,
      client_id:      j.client_id,
      job_type:       j.job_type,
      status:         j.status,
      records_synced: j.records_synced,
      error_message:  j.error_message,
      date_from:      j.date_from,
      date_to:        j.date_to,
      started_at:     j.started_at,
      completed_at:   j.completed_at,
      triggered_by:   j.triggered_by ?? null,
      client_name:    client?.name ?? null,
      connector_type: connection?.connector?.type ?? null,
    }
  })

  return NextResponse.json({ jobs, total: count ?? 0, page, per_page: PER_PAGE })
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthed(req.cookies.get('admin_session')?.value)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db    = createAdminClient()
  const count = await cleanupStuckJobs(db)
  return NextResponse.json({ cleaned: count })
}
