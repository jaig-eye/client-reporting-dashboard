// GET /api/admin/system/logs
// Returns all sync_jobs enriched with client name and connector type.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

function requireAdmin(req: NextRequest): boolean {
  const session = req.cookies.get('admin_session')?.value
  return !!session && session === process.env.ADMIN_PASSWORD
}

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createAdminClient()

  // Fetch jobs + joined client name + connector type via connection
  const { data, error } = await db
    .from('sync_jobs')
    .select(`
      *,
      client:clients(name),
      connection:client_connections(
        connector:connectors(type)
      )
    `)
    .order('started_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const jobs = (data ?? []).map((j: Record<string, unknown>) => {
    const client     = j.client     as { name: string }[]     | null
    const connection = j.connection as { connector: { type: string }[] }[] | null

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
      client_name:    client?.[0]?.name ?? null,
      connector_type: connection?.[0]?.connector?.[0]?.type ?? null,
    }
  })

  return NextResponse.json({ jobs })
}
