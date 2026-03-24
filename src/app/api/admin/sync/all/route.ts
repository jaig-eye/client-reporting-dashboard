// POST /api/admin/sync/all
// Triggers a historical backfill sync for ALL clients with active connections.
// Runs sequentially to avoid hammering the platform APIs.
// Returns a per-client summary of records synced / errors.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { syncClient } from '@/lib/sync'

function requireAdmin(req: NextRequest): boolean {
  const session = req.cookies.get('admin_session')?.value
  return !!session && session === process.env.ADMIN_PASSWORD
}

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

  for (const client of clients) {
    try {
      const records = await syncClient(client.id, 'backfill', days)
      results.push({ client_id: client.id, client_name: client.name, records })
      total += records
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ client_id: client.id, client_name: client.name, records: 0, error: msg })
    }
  }

  return NextResponse.json({ results, total_records: total })
}
