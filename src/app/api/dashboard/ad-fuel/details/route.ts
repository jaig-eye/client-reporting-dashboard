import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const token = request.cookies.get('client_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createAdminClient()
  const { data: clientData } = await db
    .from('clients')
    .select('id, ad_fuel_cut')
    .eq('dashboard_token', token)
    .maybeSingle()

  if (!clientData) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const clientId = clientData.id

  const now      = new Date()
  const toDate   = now.toISOString().slice(0, 10)
  const fromDate = new Date(now.getTime() - 183 * 86_400_000).toISOString().slice(0, 10)

  type SpendRow = { client_id: string; date: string; spend: number }

  const [ledgerRes, gRes, mRes, agencyRes] = await Promise.all([
    db.from('ad_fuel_ledger')
      .select('id, date_of_payment, invoice_date, amount_af, type, note, ach_status, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(200),
    db.rpc('daily_google_spend_by_client', { floor_date: fromDate })
      .gte('date', fromDate).lte('date', toDate)
      .eq('client_id', clientId),
    db.rpc('daily_meta_spend_by_client', { floor_date: fromDate })
      .gte('date', fromDate).lte('date', toDate)
      .eq('client_id', clientId),
    db.from('agency_settings').select('ad_fuel_cut, ad_fuel_cutoff_date').single(),
  ])

  // Resolve the AF split so daily spend is in the same units as adFuelBalance
  // (which is afPurchased − rawLifetime/split, i.e. gross-up dollars).
  const agencyCut  = (agencyRes.data?.ad_fuel_cut         ?? 0.20)        as number
  const cutoffDate = (agencyRes.data?.ad_fuel_cutoff_date ?? '2025-01-01') as string
  const clientCut  = (clientData.ad_fuel_cut as number | null) ?? agencyCut
  const split      = 1 - clientCut

  const byDate = new Map<string, { google: number; meta: number }>()
  for (const row of (gRes.data ?? []) as SpendRow[]) {
    if (row.date < cutoffDate) continue
    const d = byDate.get(row.date) ?? { google: 0, meta: 0 }
    d.google += Number(row.spend)
    byDate.set(row.date, d)
  }
  for (const row of (mRes.data ?? []) as SpendRow[]) {
    if (row.date < cutoffDate) continue
    const d = byDate.get(row.date) ?? { google: 0, meta: 0 }
    d.meta += Number(row.spend)
    byDate.set(row.date, d)
  }

  // Convert raw spend to AF-denominated spend so the balance tab's backward walk
  // uses the same units as the adFuelBalance prop (rawSpend / split = AF spend).
  const dailyDebits = Array.from(byDate.entries())
    .map(([date, { google, meta }]) => {
      const raw   = google + meta
      const total = split > 0 ? raw / split : raw
      return { date, google_spend: google, meta_spend: meta, total }
    })
    .sort((a, b) => b.date.localeCompare(a.date))

  // Exclude pre-cutoff ledger entries — the dashboard balance formula only counts
  // payments from cutoffDate onward, so pre-cutoff entries must not appear in the
  // backward walk or the reconstructed balances diverge from reality.
  type LedgerRow = { date_of_payment: string | null; invoice_date: string | null; created_at: string }
  const ledger = (ledgerRes.data ?? []).filter((e: LedgerRow) => {
    const d = e.date_of_payment ?? e.invoice_date ?? e.created_at.slice(0, 10)
    return d >= cutoffDate
  })

  return NextResponse.json({ ledger, dailyDebits })
}
