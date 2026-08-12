// ─────────────────────────────────────────────────────────────────────────────
// DataForSEO usage ledger — record + summarize spend.
//
// recordDfsUsage() writes one row (per client / operation / cron run) into
// dataforseo_usage; getDfsUsageSummary() aggregates for the agency spend panel.
// Both SOFT-FAIL (migration 191 may be unapplied) so nothing depends on them.
// ─────────────────────────────────────────────────────────────────────────────

import { createAdminClient } from '@/lib/supabase/server'

export type DfsOperation = 'rank_check' | 'serp_research' | 'keyword_overview' | 'keyword_ideas' | 'search_volume'

export async function recordDfsUsage(params: {
  operation: DfsOperation
  cost:      number
  units?:    number
  clientId?: string | null
  date?:     string
}): Promise<void> {
  if (typeof params.cost !== 'number' || params.cost <= 0) return
  try {
    const db = createAdminClient()
    await db.from('dataforseo_usage').insert({
      client_id: params.clientId ?? null,
      operation: params.operation,
      units:     params.units ?? 1,
      cost:      Number(params.cost.toFixed(6)),
      date:      params.date ?? new Date().toISOString().slice(0, 10),
    })
  } catch { /* soft-fail — ledger is best-effort */ }
}

export interface DfsUsageSummary {
  from:        string
  to:          string
  total:       number
  total_units: number
  byOperation: { operation: string; cost: number; units: number }[]
  byClient:    { client_id: string | null; client_name: string; cost: number; units: number }[]
  daily:       { date: string; cost: number }[]
}

function firstOfMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

/** Aggregate usage for a date range (defaults to the current calendar month). */
export async function getDfsUsageSummary(range?: { from?: string; to?: string }): Promise<DfsUsageSummary> {
  const to   = range?.to   ?? new Date().toISOString().slice(0, 10)
  const from = range?.from ?? firstOfMonth()
  const empty: DfsUsageSummary = { from, to, total: 0, total_units: 0, byOperation: [], byClient: [], daily: [] }
  try {
    const db = createAdminClient()
    const { data, error } = await db
      .from('dataforseo_usage')
      .select('client_id, operation, cost, units, date')
      .gte('date', from)
      .lte('date', to)
      .limit(100000)
    if (error || !Array.isArray(data)) return empty
    const rows = data as Array<{ client_id: string | null; operation: string; cost: number; units: number; date: string }>

    let total = 0, totalUnits = 0
    const byOp    = new Map<string, { cost: number; units: number }>()
    const byCl    = new Map<string | null, { cost: number; units: number }>()
    const byDay   = new Map<string, number>()
    for (const r of rows) {
      const cost = Number(r.cost) || 0
      const units = Number(r.units) || 0
      total += cost; totalUnits += units
      const op = byOp.get(r.operation) ?? { cost: 0, units: 0 }
      op.cost += cost; op.units += units; byOp.set(r.operation, op)
      const cl = byCl.get(r.client_id) ?? { cost: 0, units: 0 }
      cl.cost += cost; cl.units += units; byCl.set(r.client_id, cl)
      byDay.set(r.date, (byDay.get(r.date) ?? 0) + cost)
    }

    // Resolve client names for attributed spend.
    const clientIds = Array.from(byCl.keys()).filter((id): id is string => !!id)
    const names = new Map<string, string>()
    if (clientIds.length) {
      const { data: cls } = await db.from('clients').select('id, name').in('id', clientIds)
      for (const c of (cls ?? []) as Array<{ id: string; name: string | null }>) {
        names.set(c.id, c.name ?? 'Unknown')
      }
    }

    return {
      from, to,
      total:       Number(total.toFixed(4)),
      total_units: totalUnits,
      byOperation: Array.from(byOp.entries())
        .map(([operation, v]) => ({ operation, cost: Number(v.cost.toFixed(4)), units: v.units }))
        .sort((a, b) => b.cost - a.cost),
      byClient: Array.from(byCl.entries())
        .map(([client_id, v]) => ({
          client_id,
          client_name: client_id ? (names.get(client_id) ?? 'Unknown') : 'Agency / unattributed',
          cost: Number(v.cost.toFixed(4)), units: v.units,
        }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 12),
      daily: Array.from(byDay.entries())
        .map(([date, cost]) => ({ date, cost: Number(cost.toFixed(4)) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    }
  } catch {
    return empty
  }
}
