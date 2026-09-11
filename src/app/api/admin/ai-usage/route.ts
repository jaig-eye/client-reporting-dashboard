// GET /api/admin/ai-usage?days=30
// Aggregated AI spend for the AI tab in agency settings.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { isAdminAuthed } from '@/lib/auth'
import { getAiUsageSummary } from '@/lib/ai/usage'
import { knownRates, PRICING_UPDATED_ON } from '@/lib/ai/pricing'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Clamped: the ledger holds one row per AI call, and an unbounded window would let a
  // querystring pull the entire table into memory to render a 30-day panel.
  const raw  = Number(request.nextUrl.searchParams.get('days'))
  const days = Number.isFinite(raw) ? Math.min(365, Math.max(1, Math.trunc(raw))) : 30

  const summary = await getAiUsageSummary(days)

  return NextResponse.json({
    summary,
    // Surfaced so the panel can say these are estimates, and how stale the rate card is.
    pricing: { updatedOn: PRICING_UPDATED_ON, rates: knownRates() },
  })
}
