// /api/admin/dataforseo-usage
// Agency spend panel data: current DataForSEO account balance (live) + a metered
// spend summary for a date range (defaults to the current month). Admin-only.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, requireWriteAdmin } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { resolveDfsCreds, dfsAccountBalance } from '@/lib/connectors/dataforseo'
import { getDfsUsageSummary } from '@/lib/content/dataforseoUsage'
import { getDfsBudget, resetDfsBudgetCache } from '@/lib/content/dfsBudget'

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
  const budget = await getDfsBudget()
  return NextResponse.json({ configured: !!creds, balance, currency: 'USD', summary, budget })
}

/**
 * Set or clear the monthly ceiling.
 *
 * Agency-wide and money-bearing, so it takes the same gate as the other agency settings: a
 * read-only viewer could otherwise lift the limit to "none" with one request.
 */
export async function PUT(req: NextRequest) {
  const gate = await requireWriteAdmin()
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const body = await req.json().catch(() => ({})) as { monthly_budget?: unknown }
  const raw = body.monthly_budget
  // Null clears the ceiling deliberately; a number sets it, and 0 means spend nothing. Anything else
  // is a mistake, not a decision to spend without limit.
  const value = raw === null || raw === '' ? null : Number(raw)
  if (value !== null && (!isFinite(value) || value < 0)) {
    return NextResponse.json({ error: 'Budget must be zero or more, or empty for no limit' }, { status: 400 })
  }
  const db = createAdminClient()
  const { data: row, error: readErr } = await db.from('agency_settings').select('id').limit(1).maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'No agency settings row' }, { status: 404 })
  const { error } = await db.from('agency_settings')
    .update({ dataforseo_monthly_budget: value })
    .eq('id', (row as { id: string }).id)
  if (error) {
    const missing = /dataforseo_monthly_budget/i.test(error.message)
    return NextResponse.json(
      { error: missing ? 'Spending limits need migration 226' : error.message },
      { status: missing ? 501 : 500 },
    )
  }
  resetDfsBudgetCache()
  logActivity(gate.admin, 'updated', 'dataforseo_budget', { meta: { monthly_budget: value } })
  return NextResponse.json({ ok: true, monthly_budget: value })
}
