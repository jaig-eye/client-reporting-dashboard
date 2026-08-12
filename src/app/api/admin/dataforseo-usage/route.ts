// /api/admin/dataforseo-usage
// Agency spend panel data: current DataForSEO account balance (live) + a metered
// spend summary for a date range (defaults to the current month). Admin-only.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import { resolveDfsCreds, dfsAccountBalance } from '@/lib/connectors/dataforseo'
import { getDfsUsageSummary } from '@/lib/content/dataforseoUsage'

export async function GET(req: NextRequest) {
  if (!isAdminAuthed(req.cookies.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const from = req.nextUrl.searchParams.get('from') ?? undefined
  const to   = req.nextUrl.searchParams.get('to') ?? undefined

  // Live balance from the DataForSEO connector (or env) — free call, soft-fails to null.
  let balance: number | null = null
  let configured = false
  try {
    const db = createAdminClient()
    const { data } = await db.from('connectors').select('auth').eq('type', 'dataforseo').maybeSingle()
    const auth = ((data as { auth?: Record<string, unknown> } | null)?.auth) ?? {}
    const creds = resolveDfsCreds(auth)
    configured = !!creds
    if (creds) balance = await dfsAccountBalance(creds)
  } catch { /* soft-fail */ }

  const summary = await getDfsUsageSummary({ from, to })
  return NextResponse.json({ configured, balance, currency: 'USD', summary })
}
