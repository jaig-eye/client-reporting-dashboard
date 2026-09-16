// POST /api/admin/sync
// Triggers a manual sync for a client. Can target a specific connection or all connections.
// Used by the ClientSyncButton and admin sync panels.

import { revalidateTag } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { syncClient } from '@/lib/sync'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { logActivity } from '@/lib/activity'

// Allow up to ~13 minutes for large syncs (Vercel Pro: up to 900s)
export const maxDuration = 800

export async function POST(req: NextRequest) {
  if (!isAdminAuthed(req.cookies.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const adminSession = await getAdminSession()

  let body: { clientId?: string; connectionId?: string; jobType?: string; days?: number; excludeGsc?: boolean; adsOnly?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { clientId, connectionId, jobType, days, excludeGsc, adsOnly } = body
  if (!clientId) {
    return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  }

  const resolvedJobType = jobType === 'backfill' ? 'backfill' : 'manual'

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()

  try {
    const records = await syncClient(
      clientId,
      resolvedJobType,
      days ?? 3,
      connectionId,
      undefined,
      undefined,
      'admin',
      excludeGsc,
      adsOnly ? ['google_ads', 'meta_ads'] : undefined,
    )
    logActivity(adminSession, 'synced', 'connector', {
      clientId,
      ip,
      meta: { jobType: resolvedJobType, connectionId, records },
    })
    // Dashboard pages cache for ten minutes under this tag. Without this a manual sync wrote the
    // new figures and every page carried on showing the old ones, which reads as the sync having
    // done nothing. The cron route has always done this; the admin one never did.
    revalidateTag('client-metrics')
    return NextResponse.json({ ok: true, records })
  } catch (err) {
    console.error('Sync error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
