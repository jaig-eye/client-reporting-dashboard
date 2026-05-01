// GET /api/adfuel?locationId=<ghl_location_id>
// Public endpoint consumed by the GHL sidebar widget.
// Auth: x-api-key header must match ADFUEL_API_KEY env var.
//
// Balance calculation mirrors /api/admin/ad-fuel exactly:
//   afPurchased = sum(ad_fuel_ledger.amount_af) from cutoffDate
//   rawSpend    = lifetime google + meta spend from cutoffDate
//               - historic_bill_day gap adjustment (if set)
//   afSpend     = rawSpend / (1 - cut)
//   balance     = afPurchased - afSpend

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

function getEffectiveCutoff(cutoffDate: string, historicBillDay: number): string {
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

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey || apiKey !== process.env.ADFUEL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const locationId = new URL(request.url).searchParams.get('locationId')
  if (!locationId) {
    return NextResponse.json({ error: 'Missing locationId' }, { status: 400 })
  }

  const db = createAdminClient()

  // Find client by GHL location ID
  const { data: connData } = await db
    .from('client_connections')
    .select('client_id, connector:connectors!inner(type), config')
    .eq('external_id', locationId)
    .eq('connector.type', 'ghl')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  type ConnRow = { client_id: string; connector: { type: string }; config: Record<string, unknown> | null }
  const conn = connData as ConnRow | null

  if (!conn) {
    return NextResponse.json({ error: 'locationId not found' }, { status: 404 })
  }

  const clientId = conn.client_id

  // Load agency settings and client row in parallel
  const [agencyRes, clientRes] = await Promise.all([
    db.from('agency_settings').select('ad_fuel_cut, ad_fuel_cutoff_date').single(),
    db.from('clients').select('ad_fuel_cut, historic_bill_day').eq('id', clientId).single(),
  ])

  type AgencyRow = { ad_fuel_cut: number | null; ad_fuel_cutoff_date: string | null }
  type ClientRow = { ad_fuel_cut: number | null; historic_bill_day: number | null }

  const agency     = agencyRes.data as AgencyRow | null
  const client     = clientRes.data as ClientRow | null
  const agencyCut  = agency?.ad_fuel_cut ?? 0.20
  const cutoffDate = agency?.ad_fuel_cutoff_date ?? '2025-01-01'
  const cut        = client?.ad_fuel_cut ?? agencyCut
  const split      = 1 - cut
  const CUTOFF_MS  = new Date(cutoffDate + 'T00:00:00Z').getTime()

  // Lifetime spend + ledger in parallel
  type SumRow    = { client_id: string; spend: number }
  type LedgerRow = { amount_af: number; split_override: number | null; date_of_payment: string }

  const [gRes, mRes, ledgerRes] = await Promise.all([
    db.rpc('sum_google_spend_by_client', { from_date: cutoffDate }),
    db.rpc('sum_meta_spend_by_client',   { from_date: cutoffDate }),
    db.from('ad_fuel_ledger')
      .select('amount_af, split_override, date_of_payment')
      .eq('client_id', clientId),
  ])

  const googleLifetime = ((gRes.data ?? []) as SumRow[]).find(r => r.client_id === clientId)?.spend ?? 0
  const metaLifetime   = ((mRes.data ?? []) as SumRow[]).find(r => r.client_id === clientId)?.spend ?? 0

  // Historic bill day gap adjustment — subtract spend in the gap period
  // (cutoffDate → effectiveCutoff - 1) just like the admin route does
  let gapAdj = 0
  const historicBillDay = client?.historic_bill_day ?? null
  if (historicBillDay != null) {
    const effectiveCutoff = getEffectiveCutoff(cutoffDate, historicBillDay)
    if (effectiveCutoff > cutoffDate) {
      const gapEnd = subtractOneDay(effectiveCutoff)
      const [gGap, mGap] = await Promise.all([
        db.rpc('sum_google_spend_by_client', { from_date: cutoffDate, to_date: gapEnd }),
        db.rpc('sum_meta_spend_by_client',   { from_date: cutoffDate, to_date: gapEnd }),
      ])
      const gGapVal = ((gGap.data ?? []) as SumRow[]).find(r => r.client_id === clientId)?.spend ?? 0
      const mGapVal = ((mGap.data ?? []) as SumRow[]).find(r => r.client_id === clientId)?.spend ?? 0
      gapAdj = gGapVal + mGapVal
    }
  }

  const rawSpend = Math.max(0, (googleLifetime + metaLifetime) - gapAdj)
  const afSpend  = split > 0 ? rawSpend / split : 0

  // Sum ledger from cutoffDate (matching admin route logic)
  let afPurchased = 0
  for (const e of (ledgerRes.data ?? []) as LedgerRow[]) {
    const eMs = new Date(e.date_of_payment + 'T00:00:00Z').getTime()
    if (eMs >= CUTOFF_MS) {
      afPurchased += Number(e.amount_af)
    }
  }

  const balance = afPurchased - afSpend

  return NextResponse.json({
    locationId,
    balance:    Number(balance.toFixed(2)),
    balanceRaw: balance.toFixed(2),
    currency:   'USD',
    updatedAt:  new Date().toISOString(),
    cached:     false,
  })
}
