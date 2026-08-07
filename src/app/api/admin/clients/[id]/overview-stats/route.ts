// GET /api/admin/clients/[id]/overview-stats
// Returns key stats for the client Overview tab, computed server-side with
// correct historic_bill_day gap adjustment for the ad fuel balance.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { isAdminAuthed } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'

function getAfEffectiveCutoff(cutoffDate: string, historicBillDay: number): string {
  const c = new Date(cutoffDate + 'T00:00:00Z')
  const year = c.getUTCFullYear(), month = c.getUTCMonth(), day = c.getUTCDate()
  if (day <= historicBillDay) return new Date(Date.UTC(year, month, historicBillDay)).toISOString().slice(0, 10)
  return new Date(Date.UTC(year, month + 1, historicBillDay)).toISOString().slice(0, 10)
}

function subtractOneDay(date: string): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const db = createAdminClient()

  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10)

  const [clientRes, agencyRes] = await Promise.all([
    db.from('clients')
      .select('ad_fuel_cut, historic_bill_day')
      .eq('id', id)
      .maybeSingle(),
    db.from('agency_settings')
      .select('ad_fuel_cut, ad_fuel_cutoff_date')
      .single(),
  ])

  const client  = clientRes.data  as { ad_fuel_cut?: number | null; historic_bill_day?: number | null } | null
  const agency  = agencyRes.data  as { ad_fuel_cut?: number | null; ad_fuel_cutoff_date?: string | null } | null

  const globalCutoff = agency?.ad_fuel_cutoff_date ?? '2025-01-01'
  const cut          = client?.ad_fuel_cut ?? agency?.ad_fuel_cut ?? 0.20
  const split        = 1 - cut

  // Apply historic_bill_day gap: use effective cutoff for spend queries
  const historicBillDay  = client?.historic_bill_day ?? null
  const effectiveCutoff  = historicBillDay != null ? getAfEffectiveCutoff(globalCutoff, historicBillDay) : globalCutoff
  const gapEnd           = historicBillDay != null && effectiveCutoff > globalCutoff ? subtractOneDay(effectiveCutoff) : null

  type SumRow = { client_id: string; spend: number }

  const [gRes, mRes, gMtd, mMtd, ledgerRes, pendingRes, siteUptimeRes, pipelineRes, gGap, mGap] = await Promise.all([
    db.rpc('sum_google_spend_by_client', { from_date: globalCutoff }),
    db.rpc('sum_meta_spend_by_client',   { from_date: globalCutoff }),
    db.rpc('sum_google_spend_by_client', { from_date: monthStart }),
    db.rpc('sum_meta_spend_by_client',   { from_date: monthStart }),
    db.from('ad_fuel_ledger').select('amount_af, date_of_payment').eq('client_id', id),
    db.from('ad_fuel_ach_pending').select('amount_af').eq('client_id', id),
    db.from('sites').select('uptime_7d').eq('client_id', id).eq('status', 'active'),
    db.from('content_posts').select('id', { count: 'exact', head: true }).eq('client_id', id).eq('status', 'for_review'),
    // Gap queries only if needed
    gapEnd ? db.rpc('sum_google_spend_by_client', { from_date: globalCutoff, to_date: gapEnd }) : Promise.resolve({ data: [] }),
    gapEnd ? db.rpc('sum_meta_spend_by_client',   { from_date: globalCutoff, to_date: gapEnd }) : Promise.resolve({ data: [] }),
  ])

  const googleRaw = ((gRes.data ?? []) as SumRow[]).find(r => r.client_id === id)?.spend ?? 0
  const metaRaw   = ((mRes.data ?? []) as SumRow[]).find(r => r.client_id === id)?.spend ?? 0
  const gGapAdj   = ((gGap?.data ?? []) as SumRow[]).find(r => r.client_id === id)?.spend ?? 0
  const mGapAdj   = ((mGap?.data ?? []) as SumRow[]).find(r => r.client_id === id)?.spend ?? 0

  const rawSpend = Math.max(0, googleRaw - gGapAdj) + Math.max(0, metaRaw - mGapAdj)
  const afSpend  = split > 0 ? rawSpend / split : 0

  const cutoffMs  = new Date(globalCutoff + 'T00:00:00Z').getTime()
  let afPurchased = 0
  for (const e of (ledgerRes.data ?? []) as { amount_af: number; date_of_payment: string }[]) {
    if (new Date(e.date_of_payment + 'T00:00:00Z').getTime() >= cutoffMs) {
      afPurchased += Number(e.amount_af)
    }
  }

  const pendingAch  = ((pendingRes.data ?? []) as { amount_af: number }[]).reduce((s, r) => s + Number(r.amount_af), 0)
  const adFuelBalance = Number((afPurchased - afSpend).toFixed(2))

  const googleMtd  = ((gMtd.data ?? []) as SumRow[]).find(r => r.client_id === id)?.spend ?? 0
  const metaMtd    = ((mMtd.data ?? []) as SumRow[]).find(r => r.client_id === id)?.spend ?? 0

  const siteRows     = ((siteUptimeRes.data ?? []) as { uptime_7d: number | null }[])
  const siteUptime7d = siteRows.length > 0
    ? siteRows.reduce((sum, r) => sum + (r.uptime_7d ?? 100), 0) / siteRows.length
    : null

  return NextResponse.json({
    adFuelBalance,
    pendingAch,
    mtdSpend:            googleMtd + metaMtd,
    siteUptime7d,
    contentPipelineCount: pipelineRes.count ?? 0,
  })
}
