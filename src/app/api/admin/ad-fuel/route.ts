// GET /api/admin/ad-fuel?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
//
// All financial columns are LIFETIME values from the agency cutoff date
// (configurable in agency_settings.ad_fuel_cutoff_date, default 2025-01-01).
// The optional date filter overrides the window for those columns when active.
//
// G Raw / FB Raw / Raw Spend / AF Spend   = total spend from cutoff (or filter range)
// AF Purchased / Raw Purchased            = total ledger entries from cutoff (or filter range)
// AF Balance                              = AF Purchased − AF Spend
// Raw Balance                             = Raw Purchased − Raw Spend
// Lifetime Raw Bal                        = always from cutoff, never date-filtered
// AF Since Bill (M)                       = current billing-cycle raw / split (always)
// Avg Daily (N)                           = Since Bill / days elapsed in cycle
// Pace (O)                                = Since Bill vs expected budget pace
//
// Spend data uses RPC functions that GROUP BY client_id+date, collapsing campaign
// rows into per-client daily totals — result size = n_clients × n_days, zero risk
// of hitting any row cap regardless of campaign count.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function getCycleStart(today: Date, billDay: number): Date {
  const d = today.getDate()
  if (d >= billDay) return new Date(today.getFullYear(), today.getMonth(), billDay)
  return new Date(today.getFullYear(), today.getMonth() - 1, billDay)
}

function getCycleEnd(cycleStart: Date): Date {
  return new Date(cycleStart.getFullYear(), cycleStart.getMonth() + 1, cycleStart.getDate())
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const dateFrom = searchParams.get('date_from')
  const dateTo   = searchParams.get('date_to')

  const db    = createAdminClient()
  const today = startOfDay(new Date())

  const usingGlobalFilter = dateFrom !== null && dateTo !== null
  const filterMs0    = usingGlobalFilter ? new Date(dateFrom! + 'T00:00:00Z').getTime() : null
  const filterMs1    = usingGlobalFilter ? new Date(dateTo!   + 'T00:00:00Z').getTime() : null
  const filterStartY = usingGlobalFilter ? parseInt(dateFrom!.slice(0, 4), 10)          : -1
  const filterStartM = usingGlobalFilter ? parseInt(dateFrom!.slice(5, 7), 10) - 1      : -1

  // Round 1: fetch agency settings to get the cutoff date before we can build the RPC floor.
  const agencyRes = await db.from('agency_settings').select('ad_fuel_cut, ad_fuel_cutoff_date').single()
  type AgencyRow  = { ad_fuel_cut: number | null; ad_fuel_cutoff_date: string | null }
  const agencyData  = agencyRes.data as AgencyRow | null
  const agencyCut   = agencyData?.ad_fuel_cut   ?? 0.20
  const cutoffDate  = agencyData?.ad_fuel_cutoff_date ?? '2025-01-01'
  const CUTOFF_MS   = new Date(cutoffDate + 'T00:00:00Z').getTime()

  // Round 2: fire everything else in parallel, now that we know the cutoff date.
  const [
    clientsRes,
    ledgerRes,
    connectionsRes,
    gSpend,
    mSpend,
  ] = await Promise.all([
    db.from('clients').select('*').order('name'),
    db.from('ad_fuel_ledger')
      .select('client_id, date_of_payment, amount_af, split_override')
      .then(r => r.error ? { data: [] } : r),
    db.from('client_connections')
      .select('client_id, connector:connectors(type, external_id), config')
      .eq('status', 'active'),
    // RPCs aggregate campaign rows → per-client-day totals (migration 071 required).
    // .limit() overrides PostgREST's default 1 000-row cap; 50k covers any agency.
    db.rpc('daily_google_spend_by_client', { floor_date: cutoffDate }).limit(50000),
    db.rpc('daily_meta_spend_by_client',   { floor_date: cutoffDate }).limit(50000),
  ])

  type ConnRow   = { client_id: string; connector: { type: string; external_id: string } | null; config: Record<string, unknown> | null }
  type SpendRow  = { client_id: string; date: string; spend: number }
  type LedgerRow = { client_id: string; date_of_payment: string; amount_af: number; split_override: number | null }
  type ClientRow = { id: string; name: string; ad_fuel_cut: number | null; bill_day: number | null; monthly_budget: number | null; discord_channel_id: string | null }

  // Surface RPC errors so missing migrations are immediately visible in the response.
  if (gSpend.error) console.error('[ad-fuel] daily_google_spend_by_client RPC error:', gSpend.error)
  if (mSpend.error) console.error('[ad-fuel] daily_meta_spend_by_client RPC error:', mSpend.error)

  const connections = (connectionsRes.data ?? []) as unknown as ConnRow[]
  const allGRows    = (gSpend.data   ?? []) as SpendRow[]
  const allMRows    = (mSpend.data   ?? []) as SpendRow[]
  const clients     = (clientsRes.data ?? []) as ClientRow[]

  const googleAcctByClient: Record<string, string> = {}
  const fbAcctByClient:     Record<string, string> = {}
  const crmIdByClient:      Record<string, string> = {}
  for (const c of connections) {
    if (!c.connector) continue
    if (c.connector.type === 'google_ads') googleAcctByClient[c.client_id] = c.connector.external_id
    if (c.connector.type === 'meta_ads')   fbAcctByClient[c.client_id]     = c.connector.external_id
    if (c.connector.type === 'ghl')        crmIdByClient[c.client_id]      = (c.config?.location_id as string) ?? ''
  }

  const ledgerByClient: Record<string, LedgerRow[]> = {}
  for (const r of (ledgerRes.data ?? []) as LedgerRow[]) {
    if (!ledgerByClient[r.client_id]) ledgerByClient[r.client_id] = []
    ledgerByClient[r.client_id].push(r)
  }

  const yesterday = new Date(today.getTime() - 86_400_000)

  const rows = clients.map(client => {
    const cut   = client.ad_fuel_cut ?? agencyCut
    const split = 1 - cut

    // ── Spend ─────────────────────────────────────────────────────────────────
    // allGRows / allMRows are pre-aggregated per-client-per-day since cutoffDate.
    // Main columns: apply date filter in JS if active, else sum everything (= lifetime).
    // Lifetime totals: always the full sum — never filtered.
    let googleRaw          = 0
    let facebookRaw        = 0
    let lifetimeGoogleRaw  = 0
    let lifetimeMetaRaw    = 0

    for (const r of allGRows) {
      if (r.client_id !== client.id) continue
      const d = new Date(r.date + 'T00:00:00Z')
      const t = d.getTime()
      lifetimeGoogleRaw += Number(r.spend ?? 0)
      if (usingGlobalFilter) {
        if (filterMs0 !== null && t < filterMs0) continue
        if (filterMs1 !== null && t > filterMs1) continue
        if (client.bill_day &&
            d.getUTCFullYear() === filterStartY &&
            d.getUTCMonth()    === filterStartM &&
            d.getUTCDate()     <  client.bill_day) continue
      }
      googleRaw += Number(r.spend ?? 0)
    }

    for (const r of allMRows) {
      if (r.client_id !== client.id) continue
      const d = new Date(r.date + 'T00:00:00Z')
      const t = d.getTime()
      lifetimeMetaRaw += Number(r.spend ?? 0)
      if (usingGlobalFilter) {
        if (filterMs0 !== null && t < filterMs0) continue
        if (filterMs1 !== null && t > filterMs1) continue
        if (client.bill_day &&
            d.getUTCFullYear() === filterStartY &&
            d.getUTCMonth()    === filterStartM &&
            d.getUTCDate()     <  client.bill_day) continue
      }
      facebookRaw += Number(r.spend ?? 0)
    }

    const rawSpend         = googleRaw + facebookRaw
    const afSpend          = split > 0 ? rawSpend / split : 0
    const lifetimeRawSpend = lifetimeGoogleRaw + lifetimeMetaRaw

    // ── Ledger ────────────────────────────────────────────────────────────────
    const ledgerEntries      = ledgerByClient[client.id] ?? []
    let afPurchased          = 0
    let rawPurchased         = 0
    let rawPurchasedLifetime = 0

    for (const e of ledgerEntries) {
      const s   = e.split_override != null ? Number(e.split_override) : split
      const af  = Number(e.amount_af)
      const eMs = new Date(e.date_of_payment + 'T00:00:00Z').getTime()

      // Lifetime: all entries at or after the cutoff (never filtered)
      if (eMs >= CUTOFF_MS) {
        rawPurchasedLifetime += af * s
      }

      // Main window: all since cutoff (default) or within filter range
      const inWindow = usingGlobalFilter
        ? (filterMs0 === null || eMs >= filterMs0) && (filterMs1 === null || eMs <= filterMs1)
        : eMs >= CUTOFF_MS
      if (inWindow) {
        afPurchased  += af
        rawPurchased += af * s
      }
    }

    const afBalance          = afPurchased - afSpend
    const rawBalance         = rawPurchased - rawSpend
    const lifetimeRawBalance = rawPurchasedLifetime - lifetimeRawSpend

    // ── Billing cycle pace columns — always current cycle, never date-filtered ─
    const effectiveBillDay = client.bill_day ?? 1
    const cycleStart = getCycleStart(today, effectiveBillDay)
    let afSinceBill: number | null = null
    let avgDailyAf:  number | null = null
    let pace:        string        = ''

    if (cycleStart) {
      const cycleEnd = getCycleEnd(cycleStart)
      const cutoff   = yesterday < cycleEnd ? yesterday : new Date(cycleEnd.getTime() - 86_400_000)

      if (cutoff >= cycleStart) {
        const csMs = cycleStart.getTime()
        const ctMs = cutoff.getTime()

        let cycleRaw = 0
        for (const r of allGRows) {
          if (r.client_id !== client.id) continue
          const t = new Date(r.date + 'T00:00:00Z').getTime()
          if (t >= csMs && t <= ctMs) cycleRaw += Number(r.spend ?? 0)
        }
        for (const r of allMRows) {
          if (r.client_id !== client.id) continue
          const t = new Date(r.date + 'T00:00:00Z').getTime()
          if (t >= csMs && t <= ctMs) cycleRaw += Number(r.spend ?? 0)
        }

        afSinceBill = split > 0 ? cycleRaw / split : 0
        const daysSoFar = Math.floor((cutoff.getTime() - cycleStart.getTime()) / 86_400_000) + 1
        avgDailyAf = daysSoFar > 0 ? afSinceBill / daysSoFar : null

        if (client.monthly_budget && client.monthly_budget > 0) {
          const cycleDays = Math.floor((cycleEnd.getTime() - cycleStart.getTime()) / 86_400_000)
          const expected  = client.monthly_budget * (daysSoFar / cycleDays)
          if (expected > 0) {
            const ratio = afSinceBill / expected
            if (ratio < 0.98)      pace = 'Underspending'
            else if (ratio > 1.02) pace = 'Overspending'
            else                   pace = 'On Pace'
          }
        }
      }
    }

    return {
      clientId:          client.id,
      clientName:        client.name,
      googleAccountId:   googleAcctByClient[client.id] ?? null,
      facebookAccountId: fbAcctByClient[client.id]     ?? null,
      crmId:             crmIdByClient[client.id]       ?? null,
      discordChannelId:  client.discord_channel_id,
      billDay:           client.bill_day,
      monthlyBudget:     client.monthly_budget,
      adFuelCut:         cut,
      afBalance,
      rawBalance,
      lifetimeRawBalance,
      afPurchased,
      afSpend,
      rawPurchased,
      rawSpend,
      googleRaw,
      facebookRaw,
      afSinceBill,
      avgDailyAf,
      pace,
    }
  })

  return NextResponse.json({
    rows,
    cutoffDate,
    _debug: { gRows: allGRows.length, mRows: allMRows.length },
  })
}
