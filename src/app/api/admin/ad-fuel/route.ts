// GET /api/admin/ad-fuel?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
//
// Mirrors the Google Apps Script "Ad Fuel LIVE" dashboard logic:
//
// AF Purchased (E)  = all-time ledger sum (no date filter, like the script)
// Raw Purchased (G) = all-time ledger × split
// AF Spend (F)      = range raw / split  (range = current billing cycle by default,
//                     or the explicit date_from/date_to when set)
// Raw Spend (H)     = range google + meta raw
// G Raw (I)         = range google raw
// FB Raw (J)        = range meta raw
// AF Balance (C)    = AF Purchased − AF Spend
// Raw Balance (D)   = Raw Purchased − Raw Spend
// Lifetime Raw Bal  = Raw Purchased − ALL-TIME raw spend  (new column)
// AF Since Bill (M) = current billing-cycle raw / split (always, independent of filter)
// Avg Daily (N)     = Since Bill / days elapsed in cycle
// Pace (O)          = Since Bill vs expected budget pace
//
// Default spend window (no dates provided): per-client billing cycle
//   (cycleStart → yesterday, per getCycleStart below)
// With dates provided: global date range + first-month billing cutoff per client
//   (skips days before bill_day in the opening month of the range)

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

  const [
    clientsRes,
    agencyRes,
    ledgerRes,
    connectionsRes,
    gAllRes,
    mAllRes,
  ] = await Promise.all([
    db.from('clients').select('*').order('name'),
    db.from('agency_settings').select('ad_fuel_cut').single(),
    db.from('ad_fuel_ledger').select('client_id, date_of_payment, amount_af, split_override').then(r => r.error ? { data: [] } : r),
    db.from('client_connections')
      .select('client_id, connector:connectors(type, external_id), config')
      .eq('status', 'active'),
    // Limit to lifetime cutoff date to avoid PostgREST's default 1000-row cap
    // truncating recent data. All pre-2025 rows are excluded from calculations anyway.
    db.from('google_ads_metrics').select('client_id, date, spend').gte('date', '2025-01-01'),
    db.from('meta_ads_metrics').select('client_id, date, spend').gte('date', '2025-01-01'),
  ])

  const agencyCut = (agencyRes.data as { ad_fuel_cut: number } | null)?.ad_fuel_cut ?? 0.20

  type ConnRow    = { client_id: string; connector: { type: string; external_id: string } | null; config: Record<string, unknown> | null }
  type SpendRow   = { client_id: string; date: string; spend: number }
  type LedgerRow  = { client_id: string; date_of_payment: string; amount_af: number; split_override: number | null }
  type ClientRow  = { id: string; name: string; ad_fuel_cut: number | null; bill_day: number | null; monthly_budget: number | null; discord_channel_id: string | null }

  const connections = (connectionsRes.data ?? []) as unknown as ConnRow[]
  const allGRows    = (gAllRes.data    ?? []) as SpendRow[]
  const allMRows    = (mAllRes.data    ?? []) as SpendRow[]
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

  // Lifetime cutoff: 2025-01-01 — data before this date is excluded from all calculations
  // to avoid skewed historical data from before the system was set up.
  const LIFETIME_CUTOFF_MS = new Date('2025-01-01T00:00:00Z').getTime()

  // All-time spend per client (used for lifetime raw balance only, min date = cutoff)
  const gAllTime: Record<string, number> = {}
  const mAllTime: Record<string, number> = {}
  for (const r of allGRows) {
    if (new Date(r.date + 'T00:00:00Z').getTime() < LIFETIME_CUTOFF_MS) continue
    gAllTime[r.client_id] = (gAllTime[r.client_id] ?? 0) + Number(r.spend ?? 0)
  }
  for (const r of allMRows) {
    if (new Date(r.date + 'T00:00:00Z').getTime() < LIFETIME_CUTOFF_MS) continue
    mAllTime[r.client_id] = (mAllTime[r.client_id] ?? 0) + Number(r.spend ?? 0)
  }

  // Aggregate ledger by client (always all-time, no date filter)
  const ledgerByClient: Record<string, LedgerRow[]> = {}
  for (const r of (ledgerRes.data ?? []) as LedgerRow[]) {
    if (!ledgerByClient[r.client_id]) ledgerByClient[r.client_id] = []
    ledgerByClient[r.client_id].push(r)
  }

  // Global date filter (optional)
  const usingGlobalFilter = dateFrom !== null && dateTo !== null
  const filterMs0   = usingGlobalFilter ? new Date(dateFrom! + 'T00:00:00Z').getTime() : null
  const filterMs1   = usingGlobalFilter ? new Date(dateTo!   + 'T00:00:00Z').getTime() : null
  const filterStartY = usingGlobalFilter ? parseInt(dateFrom!.slice(0, 4), 10)     : -1
  const filterStartM = usingGlobalFilter ? parseInt(dateFrom!.slice(5, 7), 10) - 1 : -1

  const yesterday = new Date(today.getTime() - 86_400_000)

  const rows = clients.map(client => {
    const cut   = client.ad_fuel_cut ?? agencyCut
    const split = 1 - cut  // client portion: e.g. 0.8 if agency keeps 20%

    // ── Determine balance spend window ────────────────────────────────────────
    // Default: per-client current billing cycle (cycleStart → yesterday)
    // With global filter: global date range (+ first-month billing cutoff below)
    // Fall back to bill day = 1 (first of month) when not configured so the
    // balance always reflects current-period spend rather than showing purchased
    // with zero spend deducted (which looks like "lifetime" to the user).
    const effectiveBillDay = client.bill_day ?? 1
    const cycleStart = getCycleStart(today, effectiveBillDay)

    let balStartMs: number | null
    let balEndMs:   number | null
    let hasWindow:  boolean

    if (usingGlobalFilter) {
      balStartMs = filterMs0
      balEndMs   = filterMs1
      hasWindow  = true
    } else if (cycleStart) {
      balStartMs = cycleStart.getTime()
      balEndMs   = yesterday.getTime()
      hasWindow  = balEndMs >= balStartMs
    } else {
      // No bill day configured and no global filter → can't determine window → 0 spend
      balStartMs = null
      balEndMs   = null
      hasWindow  = false
    }

    // ── Balance-period spend aggregation ──────────────────────────────────────
    let googleRaw   = 0
    let facebookRaw = 0

    if (hasWindow) {
      for (const r of allGRows) {
        if (r.client_id !== client.id) continue
        const d = new Date(r.date + 'T00:00:00Z')
        const t = d.getTime()
        if (t < LIFETIME_CUTOFF_MS) continue
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
        if (t < LIFETIME_CUTOFF_MS) continue
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
    // AF Spend = raw / clientPortion  (script: actualAF = raw / cp)
    const afSpend = split > 0 ? rawSpend / split : 0

    // Lifetime raw spend (all-time, for the lifetime raw balance column)
    const lifetimeRawSpend = (gAllTime[client.id] ?? 0) + (mAllTime[client.id] ?? 0)

    // ── Ledger ────────────────────────────────────────────────────────────────
    // Cycle/range totals: entries within the balance window (same window as spend)
    // Lifetime totals: all-time, used only for the Lifetime Raw Balance column
    const ledgerEntries = ledgerByClient[client.id] ?? []
    let afPurchased          = 0
    let rawPurchased         = 0
    let rawPurchasedLifetime = 0

    for (const e of ledgerEntries) {
      const s  = e.split_override != null ? Number(e.split_override) : split
      const af = Number(e.amount_af)

      rawPurchasedLifetime += af * s

      if (hasWindow && balStartMs !== null && balEndMs !== null) {
        const eMs = new Date(e.date_of_payment + 'T00:00:00Z').getTime()
        if (eMs >= balStartMs && eMs <= balEndMs) {
          afPurchased  += af
          rawPurchased += af * s
        }
      }
    }

    const afBalance          = afPurchased - afSpend
    const rawBalance         = rawPurchased - rawSpend
    const lifetimeRawBalance = rawPurchasedLifetime - lifetimeRawSpend

    // ── Billing cycle (M, N, O) — always current cycle, never date-filtered ───
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
          if (t < LIFETIME_CUTOFF_MS) continue
          if (t >= csMs && t <= ctMs) cycleRaw += Number(r.spend ?? 0)
        }
        for (const r of allMRows) {
          if (r.client_id !== client.id) continue
          const t = new Date(r.date + 'T00:00:00Z').getTime()
          if (t < LIFETIME_CUTOFF_MS) continue
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
