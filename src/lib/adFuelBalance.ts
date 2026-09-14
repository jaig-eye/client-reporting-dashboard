// Lifetime Ad Fuel balance — the one formula, shared by /api/admin/ad-fuel and the Today page.
//
// AF Balance  = AF Purchased − AF Spend
// AF Spend    = Raw Spend / (1 − cut)                  (gross-up, not a markup)
// Raw Spend   = Google raw + Meta raw since the agency cutoff date, minus the
//               historic_bill_day gap (cutoff → day before the effective cutoff)
// AF Purchased = ledger amount_af with date_of_payment on/after the cutoff
//
// Meta spend comes from sum_meta_spend_by_client (ad-level), never campaign rows.
// Pending ACH is deliberately NOT part of the balance, matching the Ad Fuel page.

import type { createAdminClient } from '@/lib/supabase/server'

type Db = ReturnType<typeof createAdminClient>

export type AdFuelSumRow    = { client_id: string; spend: number }
export type AdFuelLedgerRow = { client_id: string; date_of_payment: string; amount_af: number; split_override: number | null }

export const DEFAULT_AD_FUEL_CUT    = 0.20
export const DEFAULT_AD_FUEL_CUTOFF = '2025-01-01'

export function getEffectiveCutoff(cutoffDate: string, historicBillDay: number): string {
  const c = new Date(cutoffDate + 'T00:00:00Z')
  const year = c.getUTCFullYear(), month = c.getUTCMonth(), day = c.getUTCDate()
  if (day <= historicBillDay) return new Date(Date.UTC(year, month, historicBillDay)).toISOString().slice(0, 10)
  return new Date(Date.UTC(year, month + 1, historicBillDay)).toISOString().slice(0, 10)
}

export function subtractOneDay(date: string): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Clients with a historic_bill_day whose effective cutoff lands after the agency cutoff,
 * grouped by the last day of the gap. Spend inside the gap is excluded from the balance.
 */
export function buildGapGroups(
  clients: { id: string; historic_bill_day: number | null }[],
  cutoffDate: string,
): [gapEnd: string, clientIds: string[]][] {
  const groups: Record<string, string[]> = {}
  for (const c of clients) {
    if (c.historic_bill_day == null) continue
    const eff = getEffectiveCutoff(cutoffDate, c.historic_bill_day)
    if (eff > cutoffDate) {
      const gapEnd = subtractOneDay(eff)
      if (!groups[gapEnd]) groups[gapEnd] = []
      groups[gapEnd].push(c.id)
    }
  }
  return Object.entries(groups)
}

/** Fold gap-window RPC results into per-client adjustments (only for that group's clients). */
export function collectGapAdjustments(
  gapEntries: [string, string[]][],
  gapResults: [{ data: unknown }, { data: unknown }][],
): { google: Record<string, number>; meta: Record<string, number> } {
  const google: Record<string, number> = {}
  const meta:   Record<string, number> = {}
  gapEntries.forEach(([, ids], i) => {
    const [gGap, mGap] = gapResults[i]
    for (const r of (gGap.data ?? []) as AdFuelSumRow[]) if (ids.includes(r.client_id)) google[r.client_id] = Number(r.spend ?? 0)
    for (const r of (mGap.data ?? []) as AdFuelSumRow[]) if (ids.includes(r.client_id)) meta[r.client_id]   = Number(r.spend ?? 0)
  })
  return { google, meta }
}

export interface LifetimeAdFuelInput {
  cut:            number
  cutoffMs:       number
  googleLifetime: number
  metaLifetime:   number
  googleGapAdj:   number
  metaGapAdj:     number
  ledger:         AdFuelLedgerRow[]
}

export interface LifetimeAdFuel {
  googleRaw:    number
  facebookRaw:  number
  rawSpend:     number
  afSpend:      number
  afPurchased:  number
  rawPurchased: number
  afBalance:    number
  rawBalance:   number
}

export function computeLifetimeAdFuel(i: LifetimeAdFuelInput): LifetimeAdFuel {
  const split       = 1 - i.cut
  const googleRaw   = Math.max(0, i.googleLifetime - i.googleGapAdj)
  const facebookRaw = Math.max(0, i.metaLifetime   - i.metaGapAdj)
  const rawSpend    = googleRaw + facebookRaw
  const afSpend     = split > 0 ? rawSpend / split : 0

  let afPurchased  = 0
  let rawPurchased = 0
  for (const e of i.ledger) {
    const s   = e.split_override != null ? Number(e.split_override) : split
    const af  = Number(e.amount_af)
    const eMs = new Date(e.date_of_payment + 'T00:00:00Z').getTime()
    if (isNaN(eMs)) continue
    if (eMs >= i.cutoffMs) {
      afPurchased  += af
      rawPurchased += af * s
    }
  }

  return {
    googleRaw, facebookRaw, rawSpend, afSpend, afPurchased, rawPurchased,
    afBalance:  afPurchased - afSpend,
    rawBalance: rawPurchased - rawSpend,
  }
}

export interface ClientAdFuelBalance extends LifetimeAdFuel {
  clientId:       string
  clientName:     string
  alertThreshold: number | null
}

/** Load every client's lifetime Ad Fuel balance (same numbers as the Ad Fuel page's AF Balance). */
export async function loadClientAdFuelBalances(db: Db): Promise<ClientAdFuelBalance[]> {
  const [agencyRes, clientsRes, ledgerRes] = await Promise.all([
    db.from('agency_settings').select('ad_fuel_cut, ad_fuel_cutoff_date').maybeSingle(),
    db.from('clients').select('id, name, ad_fuel_cut, historic_bill_day, ad_fuel_alert_threshold').order('name'),
    db.from('ad_fuel_ledger').select('client_id, date_of_payment, amount_af, split_override'),
  ])
  if (ledgerRes.error) throw new Error(`Could not load the Ad Fuel ledger: ${ledgerRes.error.message}`)

  const agency     = agencyRes.data as { ad_fuel_cut: number | null; ad_fuel_cutoff_date: string | null } | null
  const agencyCut  = agency?.ad_fuel_cut ?? DEFAULT_AD_FUEL_CUT
  const cutoffDate = agency?.ad_fuel_cutoff_date ?? DEFAULT_AD_FUEL_CUTOFF
  const cutoffMs   = new Date(cutoffDate + 'T00:00:00Z').getTime()

  const clients = (clientsRes.data ?? []) as {
    id: string; name: string; ad_fuel_cut: number | null; historic_bill_day: number | null; ad_fuel_alert_threshold: number | null
  }[]
  const gapEntries = buildGapGroups(clients, cutoffDate)

  const [[gLifeRes, mLifeRes], gapResults] = await Promise.all([
    Promise.all([
      db.rpc('sum_google_spend_by_client', { from_date: cutoffDate }),
      db.rpc('sum_meta_spend_by_client',   { from_date: cutoffDate }),
    ]),
    Promise.all(gapEntries.map(([gapEnd]) => Promise.all([
      db.rpc('sum_google_spend_by_client', { from_date: cutoffDate, to_date: gapEnd }),
      db.rpc('sum_meta_spend_by_client',   { from_date: cutoffDate, to_date: gapEnd }),
    ]))),
  ])

  const gLife: Record<string, number> = {}
  const mLife: Record<string, number> = {}
  for (const r of (gLifeRes.data ?? []) as AdFuelSumRow[]) gLife[r.client_id] = Number(r.spend ?? 0)
  for (const r of (mLifeRes.data ?? []) as AdFuelSumRow[]) mLife[r.client_id] = Number(r.spend ?? 0)
  const gap = collectGapAdjustments(gapEntries, gapResults)

  const ledgerByClient: Record<string, AdFuelLedgerRow[]> = {}
  for (const r of (ledgerRes.data ?? []) as AdFuelLedgerRow[]) {
    (ledgerByClient[r.client_id] ??= []).push(r)
  }

  return clients.map(c => ({
    clientId:       c.id,
    clientName:     c.name,
    alertThreshold: c.ad_fuel_alert_threshold,
    ...computeLifetimeAdFuel({
      cut:            c.ad_fuel_cut ?? agencyCut,
      cutoffMs,
      googleLifetime: gLife[c.id] ?? 0,
      metaLifetime:   mLife[c.id] ?? 0,
      googleGapAdj:   gap.google[c.id] ?? 0,
      metaGapAdj:     gap.meta[c.id] ?? 0,
      ledger:         ledgerByClient[c.id] ?? [],
    }),
  }))
}
