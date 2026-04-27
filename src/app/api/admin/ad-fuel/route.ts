// GET /api/admin/ad-fuel?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
//
// date_from / date_to are OPTIONAL.
//   • Omitted → balance = all-time purchased minus all-time spend (no cutoff)
//   • Provided → balance uses spend within the range; first-month billing cutoff
//     is applied per client (skips days before bill_day in the opening month of
//     the range, matching the Google Apps Script behaviour)
//
// AF Since Bill / Avg Daily / Pace always use the current billing cycle
// regardless of whether a date range is set.

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

  // Single spend fetch — all historical data, no DB-level date filter.
  // We apply the optional range + billing cutoff in JS below.
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
    db.from('ad_fuel_ledger').select('client_id, amount_af, split_override').then(r => r.error ? { data: [] } : r),
    db.from('client_connections')
      .select('client_id, connector:connectors(type, external_id), config')
      .eq('status', 'active'),
    db.from('google_ads_metrics').select('client_id, date, spend'),
    db.from('meta_ads_metrics').select('client_id, date, spend'),
  ])

  const agencyCut = (agencyRes.data as { ad_fuel_cut: number } | null)?.ad_fuel_cut ?? 0.20

  type ConnRow = { client_id: string; connector: { type: string; external_id: string } | null; config: Record<string, unknown> | null }
  const connections = (connectionsRes.data ?? []) as unknown as ConnRow[]

  const googleAcctByClient: Record<string, string> = {}
  const fbAcctByClient:     Record<string, string> = {}
  const crmIdByClient:      Record<string, string> = {}
  for (const c of connections) {
    if (!c.connector) continue
    if (c.connector.type === 'google_ads') googleAcctByClient[c.client_id] = c.connector.external_id
    if (c.connector.type === 'meta_ads')   fbAcctByClient[c.client_id]     = c.connector.external_id
    if (c.connector.type === 'ghl')        crmIdByClient[c.client_id]      = (c.config?.location_id as string) ?? ''
  }

  type SpendRow  = { client_id: string; date: string; spend: number }
  type LedgerRow = { client_id: string; amount_af: number; split_override: number | null }
  type ClientRow = { id: string; name: string; ad_fuel_cut: number | null; bill_day: number | null; monthly_budget: number | null; discord_channel_id: string | null }

  const allGRows = (gAllRes.data ?? []) as SpendRow[]
  const allMRows = (mAllRes.data ?? []) as SpendRow[]
  const clients  = (clientsRes.data ?? []) as ClientRow[]

  // Build bill_day lookup (needed for first-month cutoff)
  const billDayById: Record<string, number | null> = {}
  for (const c of clients) billDayById[c.id] = c.bill_day ?? null

  // Optional date range bounds (UTC midnight)
  const filterMs0 = dateFrom ? new Date(dateFrom + 'T00:00:00Z').getTime() : null
  const filterMs1 = dateTo   ? new Date(dateTo   + 'T00:00:00Z').getTime() : null
  const filterStartY = dateFrom ? parseInt(dateFrom.slice(0, 4), 10)  : -1
  const filterStartM = dateFrom ? parseInt(dateFrom.slice(5, 7), 10) - 1 : -1

  // Determines whether a spend row contributes to the balance calculation.
  // When no date range is set every row is included (all-time balance).
  // When a date range is set, applies the range + first-month billing cutoff
  // (matching the Google Apps Script: skip days before bill_day in the first
  // calendar month of the range to avoid double-counting the prior cycle).
  function inBalanceRange(dateStr: string, clientId: string): boolean {
    const d = new Date(dateStr + 'T00:00:00Z')
    const t = d.getTime()
    if (filterMs0 !== null && t < filterMs0) return false
    if (filterMs1 !== null && t > filterMs1) return false
    if (filterMs0 !== null) {
      const billDay = billDayById[clientId]
      if (billDay &&
          d.getUTCFullYear() === filterStartY &&
          d.getUTCMonth()    === filterStartM &&
          d.getUTCDate()     < billDay) return false
    }
    return true
  }

  // Balance-period spend aggregation
  const gSpend: Record<string, number> = {}
  const mSpend: Record<string, number> = {}
  for (const r of allGRows) {
    if (!inBalanceRange(r.date, r.client_id)) continue
    gSpend[r.client_id] = (gSpend[r.client_id] ?? 0) + Number(r.spend ?? 0)
  }
  for (const r of allMRows) {
    if (!inBalanceRange(r.date, r.client_id)) continue
    mSpend[r.client_id] = (mSpend[r.client_id] ?? 0) + Number(r.spend ?? 0)
  }

  // Aggregate ledger by client — always all-time (never date-filtered)
  const ledgerByClient: Record<string, LedgerRow[]> = {}
  for (const r of (ledgerRes.data ?? []) as LedgerRow[]) {
    if (!ledgerByClient[r.client_id]) ledgerByClient[r.client_id] = []
    ledgerByClient[r.client_id].push(r)
  }

  const rows = clients.map(client => {
    const cut   = client.ad_fuel_cut ?? agencyCut
    const split = 1 - cut  // client portion: e.g. 0.8 if agency keeps 20%

    const googleRaw   = gSpend[client.id] ?? 0
    const facebookRaw = mSpend[client.id] ?? 0
    const rawSpend    = googleRaw + facebookRaw
    // AF Spend = raw / split  (same as script: actualAF = raw / clientPortion)
    const afSpend = split > 0 ? rawSpend / split : 0

    const ledgerEntries = ledgerByClient[client.id] ?? []
    let afPurchased  = 0
    let rawPurchased = 0
    for (const e of ledgerEntries) {
      afPurchased  += Number(e.amount_af)
      const s = e.split_override != null ? Number(e.split_override) : split
      rawPurchased += Number(e.amount_af) * s
    }

    const afBalance  = afPurchased - afSpend
    const rawBalance = rawPurchased - rawSpend

    // ── Billing cycle (always current cycle, independent of date filter) ──────
    let afSinceBill: number | null = null
    let avgDailyAf:  number | null = null
    let pace:        string        = ''

    if (client.bill_day) {
      const cycleStart = getCycleStart(today, client.bill_day)
      const cycleEnd   = getCycleEnd(cycleStart)
      const yesterday  = new Date(today.getTime() - 86_400_000)
      const cutoff     = yesterday < cycleEnd ? yesterday : new Date(cycleEnd.getTime() - 86_400_000)

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
