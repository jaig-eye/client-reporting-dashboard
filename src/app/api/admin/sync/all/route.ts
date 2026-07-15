// POST /api/admin/sync/all
// Triggers a historical backfill sync for ALL clients with active connections.
// Runs in parallel batches of 3 to cut wall-clock time while avoiding API rate limits.
// Returns a per-client summary of records synced / errors.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { syncClient } from '@/lib/sync'
import { getAdminSession } from '@/lib/auth'
import { logActivity } from '@/lib/activity'

export const maxDuration = 300

function requireAdmin(req: NextRequest): boolean {
  const session = req.cookies.get('admin_session')?.value
  return !!session && session === process.env.ADMIN_PASSWORD
}

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const adminSession = await getAdminSession()
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()

  const body = await req.json().catch(() => ({}))
  const days: number = body.days ?? 90  // default 90 days for global historical sync

  const db = createAdminClient()

  // Get all clients that have at least one active connection
  const { data: clients, error } = await db
    .from('clients')
    .select('id, name')
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!clients?.length) return NextResponse.json({ results: [], total_records: 0 })

  const results: { client_id: string; client_name: string; records: number; error?: string }[] = []
  let total = 0

  // Batch clients 3 at a time — parallel within each batch, sequential across batches.
  // This cuts wall-clock time ~3x while keeping per-platform API pressure reasonable.
  const CONCURRENCY = 3
  for (let i = 0; i < clients.length; i += CONCURRENCY) {
    const batch = clients.slice(i, i + CONCURRENCY)
    const settled = await Promise.allSettled(
      batch.map(client =>
        syncClient(client.id, 'backfill', days, undefined, undefined, undefined, 'admin')
          .then(records => ({ client_id: client.id, client_name: client.name, records }))
          .catch(err => ({
            client_id:   client.id,
            client_name: client.name,
            records:     0,
            error:       err instanceof Error ? err.message : String(err),
          }))
      )
    )
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        results.push(r.value)
        total += r.value.records
      }
    }
  }

  logActivity(adminSession, 'synced', 'connector', {
    ip,
    meta: { scope: 'all_clients', total_records: total, days },
  })
  return NextResponse.json({ results, total_records: total })
}
