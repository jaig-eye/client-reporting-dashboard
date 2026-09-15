// Ad Fuel balance for one client, for the dashboard sidebar.
//
// This is the calculation the Summary page used, moved here unchanged so the balance can sit in
// the sidebar on every page. It must keep matching the admin Ad Fuel page: Ad Fuel purchased since
// the cutoff, minus lifetime spend since the cutoff grossed up by the client's cut, with the
// historic bill-day gap taken out. Raw mode never applies here — a balance is a balance.

import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { getEffectiveCutoff, subtractOneDay, DEFAULT_AD_FUEL_CUTOFF } from '@/lib/adFuelBalance'
import type { Client } from '@/lib/types'

type SumRow    = { client_id: string; spend: number }
type AmountRow = { amount_af: number }

export interface AdFuelSettings {
  ad_fuel_cut?: number | null
  ad_fuel_cutoff_date?: string | null
}

export interface ClientAdFuelSummary {
  /** Only clients who have bought Ad Fuel see the widget. */
  show: boolean
  /** null when the spend totals could not be read — never show a falsely full balance. */
  balance: number | null
  /** ACH payments still in transit. */
  pending: number
  /** Last 30 days of billed spend. Only sets how full the gauge looks; never part of the balance. */
  monthlyReference: number
}

const firstSpend = (res: { data: unknown }) => Number(((res.data ?? []) as SumRow[])[0]?.spend ?? 0)
const sumAmounts = (res: { data: unknown }) =>
  ((res.data ?? []) as AmountRow[]).reduce((s, r) => s + (Number(r.amount_af) || 0), 0)

// Cached briefly: the layout renders on every navigation, and a payment recorded in the admin
// shows up within a minute.
const loadSummary = unstable_cache(
  async (clientId: string, cut: number, cutoffDate: string, historicBillDay: number | null): Promise<ClientAdFuelSummary> => {
    const db = createAdminClient()
    const balanceSplit = 1 - cut
    const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)

    // Aggregate RPCs, not row reads, so high-volume clients don't hit PostgREST's 1000-row cap.
    const [gLifeRpc, mLifeRpc, ledgerRes, achRes, g30Rpc, m30Rpc] = await Promise.all([
      db.rpc('sum_google_spend_by_client', { from_date: cutoffDate }).eq('client_id', clientId),
      db.rpc('sum_meta_spend_by_client',   { from_date: cutoffDate }).eq('client_id', clientId),
      db.from('ad_fuel_ledger').select('amount_af').eq('client_id', clientId).gte('date_of_payment', cutoffDate),
      db.from('ad_fuel_ach_pending').select('amount_af').eq('client_id', clientId),
      db.rpc('sum_google_spend_by_client', { from_date: since30 }).eq('client_id', clientId),
      db.rpc('sum_meta_spend_by_client',   { from_date: since30 }).eq('client_id', clientId),
    ])

    const spendRpcFailed = !!(gLifeRpc.error || mLifeRpc.error)
    if (spendRpcFailed) console.error('[ad-fuel] spend RPCs failed:', gLifeRpc.error, mLifeRpc.error)

    let gRawLife = firstSpend(gLifeRpc)
    let mRawLife = firstSpend(mLifeRpc)

    // Clients with a historic bill day don't count spend between the cutoff and their first bill day.
    if (!spendRpcFailed && historicBillDay != null) {
      const effCutoff = getEffectiveCutoff(cutoffDate, historicBillDay)
      if (effCutoff > cutoffDate) {
        const gapEnd = subtractOneDay(effCutoff)
        const [gGap, mGap] = await Promise.all([
          db.rpc('sum_google_spend_by_client', { from_date: cutoffDate, to_date: gapEnd }).eq('client_id', clientId),
          db.rpc('sum_meta_spend_by_client',   { from_date: cutoffDate, to_date: gapEnd }).eq('client_id', clientId),
        ])
        gRawLife = Math.max(0, gRawLife - firstSpend(gGap))
        mRawLife = Math.max(0, mRawLife - firstSpend(mGap))
      }
    }

    const rawLifetime = gRawLife + mRawLife
    const afLifetime  = balanceSplit > 0 ? rawLifetime / balanceSplit : rawLifetime
    const purchased   = sumAmounts(ledgerRes)
    const raw30       = firstSpend(g30Rpc) + firstSpend(m30Rpc)

    return {
      show:             purchased > 0,
      balance:          spendRpcFailed ? null : purchased - afLifetime,
      pending:          sumAmounts(achRes),
      monthlyReference: balanceSplit > 0 ? raw30 / balanceSplit : raw30,
    }
  },
  ['dashboard-ad-fuel-summary'],
  { revalidate: 60, tags: ['client-metrics', 'ad-fuel'] },
)

export function getClientAdFuelSummary(client: Client, settings: AdFuelSettings | null): Promise<ClientAdFuelSummary> {
  const cut             = client.ad_fuel_cut != null ? client.ad_fuel_cut : (settings?.ad_fuel_cut ?? 0)
  const cutoffDate      = settings?.ad_fuel_cutoff_date ?? DEFAULT_AD_FUEL_CUTOFF
  const historicBillDay = ((client as unknown as Record<string, unknown>).historic_bill_day as number | null | undefined) ?? null
  return loadSummary(client.id, cut, cutoffDate, historicBillDay)
}
