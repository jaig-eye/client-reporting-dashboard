// GET /api/admin/ad-fuel?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
//
// All values are scoped to the current billing cycle (bill_day → yesterday)
// unless an explicit date range is provided.
//
// AF Purchased (E)  = ledger entries whose date_of_payment is in the cycle
// Raw Purchased (G) = cycle ledger × split
// AF Spend (F)      = cycle raw spend / split
// Raw Spend (H)     = cycle google + meta raw
// G Raw (I)         = cycle google raw
// FB Raw (J)        = cycle meta raw
// AF Balance (C)    = AF Purchased − AF Spend  (both cycle-scoped)
// Raw Balance (D)   = Raw Purchased − Raw Spend  (both cycle-scoped)
// Lifetime Raw Bal  = all-time raw purchased (2025-01-01+) − all-time raw spend
// AF Since Bill (M) = current billing-cycle raw / split
// Avg Daily (N)     = Since Bill / days elapsed in cycle
// Pace (O)          = Since Bill vs expected budget pace
//
// Spend data comes via RPC functions that GROUP BY client_id+date before
// returning results, collapsing campaign-level rows into per-client daily totals.
// This means the result set is at most n_clients × n_days regardless of how
// many campaigns each client runs, sidestepping any row-cap issues entirely.

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

  // Billing cycles are at most ~31 days old. 65-day floor covers every bill_day.
  const spendFloor = usingGlobalFilter
    ? dateFrom!
    : new Date(today.getTime() - 65 * 86_400_000).toISOString().slice(0, 10)

  // Lifetime cutoff — data before this date is excluded to avoid skewed history.
  const LIFETIME_CUTOFF     = '2025-01-01'
  const LIFETIME_CUTOFF_MS  = new Date(LIFETIME_CUTOFF + 'T00:00:00Z').getTime()

  const [
    clientsRes,
    agencyRes,
    ledgerRes,
    connectionsRes,
    gCycleRes,
    mCycleRes,
    gLifeRes,
    mLifeRes,
  ] = await Promise.all([
    db.from('clients').select('*').order('name'),
    db.from('agency_settings').select('ad_fuel_cut').single(),
    db.from('ad_fuel_ledger')
      .select('client_id, date_of_payment, amount_af, split_override')
      .then(r => r.error ? { data: [] } : r),
    db.from('client_connections')
      .select('client_id, connector:connectors(type, external_id), config')
      .eq('status', 'active'),
    // RPCs aggregate campaign-level rows to per-client-day totals at the DB layer,
    // so result size = n_clients × n_days regardless of campaign count.
    db.rpc('daily_google_spend_by_client', { floor_date: spendFloor }),
    db.rpc('daily_meta_spend_by_client',   { floor_date: spendFloor }),
    // Lifetime totals (2025-01-01+) for the Lifetime Raw Balance column only.
    db.rpc('lifetime_google_spend_by_client', { cutoff_date: LIFETIME_CUTOFF }),
    db.rpc('lifetime_meta_spend_by_client',   { cutoff_date: LIFETIME_CUTOFF }),
  ])

  const agencyCut = (agencyRes.data as { ad_fuel_cut: number } | null)?.ad_fuel_cut ?? 0.20

  type ConnRow   = { client_id: string; connector: { type: string; external_id: string } | null; config: Record<string, unknown> | null }
  type SpendRow  = { client_id: string; date: string; spend: number }
  type LifeRow   = { client_id: string; spend: number }
  type LedgerRow = { client_id: string; date_of_payment: string; amount_af: number; split_override: number | null }
  type ClientRow = { id: string; name: string; ad_fuel_cut: number | null; bill_day: number | null; monthly_budget: number | null; discord_channel_id: string | null }

  const connections = (connectionsRes.data ?? []) as unknown as ConnRow[]
  const allGRows    = (gCycleRes.data  ?? []) as SpendRow[]
  const allMRows    = (mCycleRes.data  ?? []) as SpendRow[]
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

  // All-time spend per client from the lifetime RPCs (2025-01-01+)
  const gAllTime: Record<string, number> = {}
  const mAllTime: Record<string, number> = {}
  for (const r of (gLifeRes.data ?? []) as LifeRow[]) {
    gAllTime[r.client_id] = (gAllTime[r.client_id] ?? 0) + Number(r.spend ?? 0)
  }
  for (const r of (mLifeRes.data ?? []) as LifeRow[]) {
    mAllTime[r.client_id] = (mAllTime[r.client_id] ?? 0) + Number(r.spend ?? 0)
  }

  // Aggregate ledger by client
  const ledgerByClient: Record<string, LedgerRow[]> = {}
  for (const r of (ledgerRes.data ?? []) as LedgerRow[]) {
    if (!ledgerByClient[r.client_id]) ledgerByClient[r.client_id] = []
    ledgerByClient[r.client_id].push(r)
  }

  const yesterday = new Date(today.getTime() - 86_400_000)

  const rows = clients.map(client => {
    const cut   = client.ad_fuel_cut ?? agencyCut
    const split = 1 - cut

    // ── Billing cycle window ──────────────────────────────────────────────────
    const effectiveBillDay = client.bill_day ?? 1
    const cycleStart = getCycleStart(today, effectiveBillDay)

    let balStartMs: number | null
    let balEndMs:   number | null
    let hasWindow:  boolean

    if (usingGlobalFilter) {
      balStartMs = filterMs0
      balEndMs   = filterMs1
      hasWindow  = true
    } else {
      balStartMs = cycleStart.getTime()
      balEndMs   = yesterday.getTime()
      hasWindow  = balEndMs >= balStartMs
    }

    // ── Spend aggregation (billing cycle window) ──────────────────────────────
    let googleRaw   = 0
    let facebookRaw = 0

    if (hasWindow) {
      for (const r of allGRows) {
        if (r.client_id !== client.id) continue
        const d = new Date(r.date + 'T00:00:00Z')
        const t = d.getTime()
        if (balStartMs !== null && t < balStartMs) continue
        if (balEndMs   !== null && t > balEndMs)   continue
        if (usingGlobalFilter && client.bill_day &&
            d.getUTCFullYear() === filterStartY &&
            d.getUTCMonth()    === filterStartM &&
            d.getUTCDate()     <  client.bill_day) continue
        googleRaw += Number(r.spend ?? 0)
      }
      for (const r of allMRows) {
        if (r.client_id !== client.id) continue
        const d = new Date(r.date + 'T00:00:00Z')
        const t = d.getTime()
        if (balStartMs !== null && t < balStartMs) continue
        if (balEndMs   !== null && t > balEndMs)   continue
        if (usingGlobalFilter && client.bill_day &&
            d.getUTCFullYear() === filterStartY &&
            d.getUTCMonth()    === filterStartM &&
            d.getUTCDate()     <  client.bill_day) continue
        facebookRaw += Number(r.spend ?? 0)
      }
    }

    const rawSpend = googleRaw + facebookRaw
    const afSpend  = split > 0 ? rawSpend / split : 0

    // Lifetime raw spend (for lifetime raw balance column only)
    const lifetimeRawSpend = (gAllTime[client.id] ?? 0) + (mAllTime[client.id] ?? 0)

    // ── Ledger ────────────────────────────────────────────────────────────────
    const ledgerEntries      = ledgerByClient[client.id] ?? []
    let afPurchased          = 0
    let rawPurchased         = 0
    let rawPurchasedLifetime = 0

    for (const e of ledgerEntries) {
      const s  = e.split_override != null ? Number(e.split_override) : split
      const af = Number(e.amount_af)
      const eMs = new Date(e.date_of_payment + 'T00:00:00Z').getTime()

      // Lifetime raw balance: all entries since the lifetime cutoff
      if (eMs >= LIFETIME_CUTOFF_MS) {
        rawPurchasedLifetime += af * s
      }

      // Billing cycle balance: entries within the current window only
      if (hasWindow && balStartMs !== null && balEndMs !== null) {
        if (eMs >= balStartMs && eMs <= balEndMs) {
          afPurchased  += af
          rawPurchased += af * s
        }
      }
    }

    const afBalance          = afPurchased - afSpend
    const rawBalance         = rawPurchased - rawSpend
    const lifetimeRawBalance = rawPurchasedLifetime - lifetimeRawSpend

    // ── Billing cycle pace columns (M, N, O) — always current cycle ───────────
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

  return NextResponse.json(rows)
}
