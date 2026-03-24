// POST /api/admin/sync
// Triggers a manual sync for a client. Can target a specific connection or all connections.
// Used by the ClientSyncButton and admin sync panels.

import { NextRequest, NextResponse } from 'next/server'
import { syncClient } from '@/lib/sync'

export async function POST(req: NextRequest) {
  // Auth check: must have admin_session cookie
  const session = req.cookies.get('admin_session')?.value
  if (!session || session !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { clientId?: string; connectionId?: string; jobType?: string; days?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { clientId, connectionId, jobType, days } = body
  if (!clientId) {
    return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  }

  const resolvedJobType = jobType === 'backfill' ? 'backfill' : 'manual'

  try {
    const records = await syncClient(
      clientId,
      resolvedJobType,
      days ?? 3,
      connectionId
    )
    return NextResponse.json({ ok: true, records })
  } catch (err) {
    console.error('Sync error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
