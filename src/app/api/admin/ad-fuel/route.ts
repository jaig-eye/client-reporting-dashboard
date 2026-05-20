// GET /api/admin/ad-fuel?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
//
// All financial columns are from the agency cutoff date (default 2025-01-01).
// The optional date filter overrides the window for main columns when active.
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
// Query strategy — avoids PostgREST's server-side row cap:
//   Lifetime/filter spend  → sum_*_spend_by_client RPC (1 row per client, no cap possible)
//   Billing-cycle spend    → daily_*_spend_by_client RPC, last 65 days only
//                            (n_clients × 65 ≈ 3 250 rows — well under any cap)

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

/** Returns the first occurrence of historicBillDay on or after cutoffDate (YYYY-MM-DD). */
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

  // Round 1: agency settings (need cutoff date before building RPC params)
  const agencyRes = await db.from('agency_settings').select('ad_fuel_cut, ad_fuel_cutoff_date').single()
  type AgencyRow  = { ad_fuel_cut: number | null; ad_fuel_cutoff_date: string | null }
  const agencyData  = agencyRes.data as AgencyRow | null
  const agencyCut   = agencyData?.ad_fuel_cut ?? 0.20
  const cutoffDate  = agencyData?.ad_fuel_cutoff_date ?? '2025-01-01'
  const CUTOFF_MS   = new Date(cutoffDate + 'T00:00:00Z').getTime()

  // Billing cycle data only needs the last 65 days (covers any bill_day).
  const cycleFloor = new Date(today.getTime() - 65 * 86_400_000).toISOString().slice(0, 10)

  // Round 2: all other queries in parallel.
  //   sum_*_spend_by_client   → 1 row per client (immune to row cap)
  //   daily_*_spend_by_client → 1 row per client per day, last 65 days only (~3 250 rows)
  const [
    clientsRes,
    ledgerRes,
    connectionsRes,
    gLifeRes,
    mLifeRes,
    gCycleRes,
    mCycleRes,
  ] = await Promise.all([
    db.from('clients').select('*').order('name'),
    db.from('ad_fuel_ledger')
      .select('client_id, date_of_payment, amount_af, split_override')
      .then(r => r.error ? { data: [] } : r),
    db.from('client_connections')
      .select('client_id, connector:connectors(type, external_id), config')
      .eq('status', 'active'),
    db.rpc('sum_google_spend_by_client', { from_date: cutoffDate }),
    db.rpc('sum_meta_spend_by_client',   { from_date: cutoffDate }),
    db.rpc('daily_google_spend_by_client', { floor_date: cycleFloor }),
    db.rpc('daily_meta_spend_by_client',   { floor_date: cycleFloor }),
  ])

  // Round 3 (only when global filter active): fetch filter-range totals.
  type SumRow   = { client_id: string; spend: number }
  type DayRow   = { client_id: string; date: string; spend: number }
  type LedgerRow = { client_id: string; date_of_payment: string; amount_af: number; split_override: number | null }
  type ConnRow  = { client_id: string; connector: { type: string; external_id: string } | null; config: Record<string, unknown> | null }
  type ClientRow = { id: string; name: string; ad_fuel_cut: number | null; bill_day: number | null; historic_bill_day: number | null; monthly_budget: number | null; discord_channel_id: string | null; ad_fuel_alert_threshold: number | null; ad_fuel_alert_muted: boolean | null; auto_pause_ads: boolean | null; auto_resume_ads: boolean | null; campaigns_paused_at: string | null }

  let gFilterMap: Record<string, number> = {}
  let mFilterMap: Record<string, number> = {}
  if (usingGlobalFilter) {
    const [gFilt, mFilt] = await Promise.all([
      db.rpc('sum_google_spend_by_client', { from_date: dateFrom!, to_date: dateTo! }),
      db.rpc('sum_meta_spend_by_client',   { from_date: dateFrom!, to_date: dateTo! }),
    ])
    for (const r of (gFilt.data ?? []) as SumRow[]) gFilterMap[r.client_id] = (gFilterMap[r.client_id] ?? 0) + Number(r.spend ?? 0)
    for (const r of (mFilt.data ?? []) as SumRow[]) mFilterMap[r.client_id] = (mFilterMap[r.client_id] ?? 0) + Number(r.spend ?? 0)
  }

  // Build lookup maps
  const gLifeMap: Record<string, number> = {}
  const mLifeMap: Record<string, number> = {}
  for (const r of (gLifeRes.data ?? []) as SumRow[]) gLifeMap[r.client_id] = Number(r.spend ?? 0)
  for (const r of (mLifeRes.data ?? []) as SumRow[]) mLifeMap[r.client_id] = Number(r.spend ?? 0)

  // For clients with historic_bill_day, subtract gap spend (cutoffDate → effectiveCutoff-1).
  // Groups by unique gap-end date to minimize extra RPC calls.
  const historicClients = (clientsRes.data ?? []).filter((c: Record<string, unknown>) => c.historic_bill_day != null) as ClientRow[]
  const gapAdjustGoogle: Record<string, number> = {}
  const gapAdjustMeta:   Record<string, number> = {}
  if (historicClients.length > 0) {
    const gapGroups: Record<string, string[]> = {}
    for (const c of historicClients) {
      const eff = getEffectiveCutoff(cutoffDate, c.historic_bill_day!)
      if (eff > cutoffDate) {
        const gapEnd = subtractOneDay(eff)
        if (!gapGroups[gapEnd]) gapGroups[gapEnd] = []
        gapGroups[gapEnd].push(c.id)
      }
    }
    await Promise.all(Object.entries(gapGroups).map(async ([gapEnd, ids]) => {
      const [gGap, mGap] = await Promise.all([
        db.rpc('sum_google_spend_by_client', { from_date: cutoffDate, to_date: gapEnd }),
        db.rpc('sum_meta_spend_by_client',   { from_date: cutoffDate, to_date: gapEnd }),
      ])
      for (const r of (gGap.data ?? []) as SumRow[]) if (ids.includes(r.client_id)) gapAdjustGoogle[r.client_id] = Number(r.spend ?? 0)
      for (const r of (mGap.data ?? []) as SumRow[]) if (ids.includes(r.client_id)) gapAdjustMeta[r.client_id]   = Number(r.spend ?? 0)
    }))
  }

  const gCycleRows = (gCycleRes.data ?? []) as DayRow[]
  const mCycleRows = (mCycleRes.data ?? []) as DayRow[]

  const connections = (connectionsRes.data ?? []) as unknown as ConnRow[]
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

    // ── Main spend columns ────────────────────────────────────────────────────
    // Lifetime: from the SUM aggregate (one value per client, no cap risk).
    // For clients with historic_bill_day, gap spend (cutoff → effectiveCutoff-1) is subtracted.
    const gAdj = gapAdjustGoogle[client.id] ?? 0
    const mAdj = gapAdjustMeta[client.id]   ?? 0
    const googleRaw          = usingGlobalFilter ? (gFilterMap[client.id] ?? 0) : Math.max(0, (gLifeMap[client.id] ?? 0) - gAdj)
    const facebookRaw        = usingGlobalFilter ? (mFilterMap[client.id] ?? 0) : Math.max(0, (mLifeMap[client.id] ?? 0) - mAdj)
    const lifetimeGoogleRaw  = Math.max(0, (gLifeMap[client.id] ?? 0) - gAdj)
    const lifetimeMetaRaw    = Math.max(0, (mLifeMap[client.id] ?? 0) - mAdj)

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

      if (eMs >= CUTOFF_MS) rawPurchasedLifetime += af * s

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
        for (const r of gCycleRows) {
          if (r.client_id !== client.id) continue
          const t = new Date(r.date + 'T00:00:00Z').getTime()
          if (t >= csMs && t <= ctMs) cycleRaw += Number(r.spend ?? 0)
        }
        for (const r of mCycleRows) {
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
      discordChannelId:       client.discord_channel_id,
      adFuelAlertThreshold:   client.ad_fuel_alert_threshold,
      billDay:                client.bill_day,
      historicBillDay:        client.historic_bill_day,
      monthlyBudget:          client.monthly_budget,
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
      adFuelAlertMuted:  client.ad_fuel_alert_muted  ?? false,
      autoPauseAds:      client.auto_pause_ads       ?? false,
      autoResumeAds:     client.auto_resume_ads      ?? false,
      campaignsPausedAt: client.campaigns_paused_at  ?? null,
    }
  })

  return NextResponse.json({
    rows,
    cutoffDate,
    _debug: {
      gLifeRows: (gLifeRes.data ?? []).length,
      mLifeRows: (mLifeRes.data ?? []).length,
      gCycleRows: gCycleRows.length,
      mCycleRows: mCycleRows.length,
    },
  })
}
