// GET /api/admin/ad-fuel?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
// Returns per-client Ad Fuel dashboard rows with all computed columns.

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
  const prev = new Date(today.getFullYear(), today.getMonth() - 1, billDay)
  return prev
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

  const db = createAdminClient()
  const today = startOfDay(new Date())

  const [
    clientsRes,
    agencyRes,
    gadsRes,
    metaRes,
    ledgerRes,
    connectionsRes,
  ] = await Promise.all([
    db.from('clients').select('*').order('name'),
    db.from('agency_settings').select('ad_fuel_cut').single(),
    dateFrom && dateTo
      ? db.from('google_ads_metrics').select('client_id, spend').gte('date', dateFrom).lte('date', dateTo)
      : Promise.resolve({ data: [] as { client_id: string; spend: number }[] }),
    dateFrom && dateTo
      ? db.from('meta_ads_metrics').select('client_id, spend').gte('date', dateFrom).lte('date', dateTo)
      : Promise.resolve({ data: [] as { client_id: string; spend: number }[] }),
    db.from('ad_fuel_ledger').select('client_id, amount_af, split_override').then(r => r.error ? { data: [] } : r),
    db.from('client_connections')
      .select('client_id, connector:connectors(type, external_id), config')
      .eq('status', 'active'),
  ])

  const agencyCut = (agencyRes.data as { ad_fuel_cut: number } | null)?.ad_fuel_cut ?? 0.20

  type ConnRow = { client_id: string; connector: { type: string; external_id: string } | null; config: Record<string, unknown> | null }
  const connections = (connectionsRes.data ?? []) as unknown as ConnRow[]

  // Build per-client account ID maps
  const googleAcctByClient: Record<string, string> = {}
  const fbAcctByClient:     Record<string, string> = {}
  const crmIdByClient:      Record<string, string> = {}
  for (const c of connections) {
    if (!c.connector) continue
    if (c.connector.type === 'google_ads')  googleAcctByClient[c.client_id] = c.connector.external_id
    if (c.connector.type === 'meta_ads')    fbAcctByClient[c.client_id]     = c.connector.external_id
    if (c.connector.type === 'ghl')         crmIdByClient[c.client_id]      = (c.config?.location_id as string) ?? ''
  }

  // Aggregate spend by client for the selected range
  const gSpend: Record<string, number> = {}
  const mSpend: Record<string, number> = {}
  for (const r of (gadsRes.data ?? []) as { client_id: string; spend: number }[]) {
    gSpend[r.client_id] = (gSpend[r.client_id] ?? 0) + Number(r.spend ?? 0)
  }
  for (const r of (metaRes.data ?? []) as { client_id: string; spend: number }[]) {
    mSpend[r.client_id] = (mSpend[r.client_id] ?? 0) + Number(r.spend ?? 0)
  }

  // Aggregate ledger by client
  type LedgerRow = { client_id: string; amount_af: number; split_override: number | null }
  const ledgerByClient: Record<string, LedgerRow[]> = {}
  for (const r of (ledgerRes.data ?? []) as LedgerRow[]) {
    if (!ledgerByClient[r.client_id]) ledgerByClient[r.client_id] = []
    ledgerByClient[r.client_id].push(r)
  }

  // For billing-cycle spend, query current cycle date range per client
  // We compute this server-side from the spend data we already have (gSpend/mSpend cover full history)
  // For "since bill day" we need unbounded spend — fetch all spend for billing cycle computation
  const [gcycleRes, mcycleRes] = await Promise.all([
    db.from('google_ads_metrics').select('client_id, date, spend'),
    db.from('meta_ads_metrics').select('client_id, date, spend'),
  ])

  type SpendRow = { client_id: string; date: string; spend: number }
  const gcycleRows = (gcycleRes.data ?? []) as SpendRow[]
  const mcycleRows = (mcycleRes.data ?? []) as SpendRow[]

  type ClientRow = { id: string; name: string; ad_fuel_cut: number | null; bill_day: number | null; monthly_budget: number | null; discord_channel_id: string | null }
  const clients = (clientsRes.data ?? []) as ClientRow[]

  const rows = clients.map(client => {
    const cut   = client.ad_fuel_cut ?? agencyCut
    const split = 1 - cut  // portion that goes to raw ads

    const googleRaw  = gSpend[client.id] ?? 0
    const facebookRaw = mSpend[client.id] ?? 0
    const rawSpend   = googleRaw + facebookRaw
    const afSpend    = split > 0 ? rawSpend / split : 0

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

    // Billing cycle calculations
    let afSinceBill: number | null   = null
    let avgDailyAf: number | null    = null
    let pace: string                 = ''

    if (client.bill_day) {
      const cycleStart = getCycleStart(today, client.bill_day)
      const cycleEnd   = getCycleEnd(cycleStart)
      const yesterday  = new Date(today.getTime() - 86_400_000)
      const cutoff     = yesterday < cycleEnd ? yesterday : new Date(cycleEnd.getTime() - 86_400_000)

      if (cutoff >= cycleStart) {
        const csMs = cycleStart.getTime()
        const ctMs = cutoff.getTime()

        let cycleRaw = 0
        for (const r of gcycleRows) {
          if (r.client_id !== client.id) continue
          const t = new Date(r.date + 'T00:00:00Z').getTime()
          if (t >= csMs && t <= ctMs) cycleRaw += Number(r.spend ?? 0)
        }
        for (const r of mcycleRows) {
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
