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

  // Resolve DataForSEO creds (connector auth or env) — a cheap DB lookup.
  let creds: ReturnType<typeof resolveDfsCreds> = null
  try {
    const db = createAdminClient()
    const { data } = await db.from('connectors').select('auth').eq('type', 'dataforseo').maybeSingle()
    creds = resolveDfsCreds(((data as { auth?: Record<string, unknown> } | null)?.auth) ?? {})
  } catch { /* soft-fail */ }

  // Run the live balance probe (up to 8s) and the usage aggregation concurrently, so the
  // panel renders after max(balance, summary) rather than their sum.
  const [balance, summary] = await Promise.all([
    creds ? dfsAccountBalance(creds).catch(() => null) : Promise.resolve(null),
    getDfsUsageSummary({ from, to }),
  ])
  return NextResponse.json({ configured: !!creds, balance, currency: 'USD', summary })
}
