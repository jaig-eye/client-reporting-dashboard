// ─────────────────────────────────────────────────────────────────────────────
// AI spend ledger — record + summarise.
//
// recordAiUsage() writes one row per provider call into ai_usage (migration 213);
// getAiUsageSummary() aggregates it for the AI tab in agency settings.
//
// Both SOFT-FAIL. Metering is an observability concern and must never be able to break
// content generation: if the table is missing because migration 213 has not been applied, or
// the insert fails for any other reason, the caller carries on and the article is still
// written. This mirrors lib/content/dataforseoUsage.ts, which exists for the same reason.
// ─────────────────────────────────────────────────────────────────────────────

import { createAdminClient } from '@/lib/supabase/server'

/**
 * What the call was FOR, not which endpoint served it. Costs are read per-operation to answer
 * "where is the money going", so these stay stable even if routes move.
 */
export type AiOperation =
  | 'topics'          // lib/content/generateTopics.ts
  | 'article'         // first generation of a post
  | 'rewrite'         // /api/admin/content/regenerate
  | 'full_regenerate' // new topic + fresh article
  | 'brief'           // topic briefs
  | 'brand_dna'
  | 'silo'
  | 'service_area'
  | 'image'
  | 'alert'           // ad-fuel budget alert summaries
  | 'other'

export interface AiUsageRecord {
  provider:      'anthropic' | 'openai'
  model:         string
  operation:     AiOperation
  inputTokens?:  number
  outputTokens?: number
  /** Images generated, or completions issued. Defaults to 1. */
  units?:        number
  /** null = model absent from the pricing table; recorded honestly rather than as 0. */
  costUsd:       number | null
  clientId?:     string | null
  postId?:       string | null
}

export async function recordAiUsage(r: AiUsageRecord): Promise<void> {
  try {
    const db = createAdminClient()
    const { error } = await db.from('ai_usage').insert({
      provider:      r.provider,
      model:         r.model,
      operation:     r.operation,
      input_tokens:  r.inputTokens  ?? 0,
      output_tokens: r.outputTokens ?? 0,
      units:         r.units ?? 1,
      cost_usd:      r.costUsd,
      client_id:     r.clientId ?? null,
      post_id:       r.postId   ?? null,
      date:          new Date().toISOString().slice(0, 10),
    })
    if (error) {
      // Logged, never thrown. A missing relation here means migration 213 is pending.
      console.warn('[ai/usage] could not record usage (apply migration 213?):', error.message)
    }
  } catch (e) {
    console.warn('[ai/usage] usage insert threw:', e instanceof Error ? e.message : e)
  }
}

export interface AiUsageSummary {
  /** Inclusive window actually summarised. */
  from: string
  to:   string
  totals: {
    calls:        number
    inputTokens:  number
    outputTokens: number
    costUsd:      number
    /** Calls whose model had no pricing entry — their cost is NOT in costUsd. */
    unpricedCalls: number
  }
  byModel:     { model: string;     calls: number; inputTokens: number; outputTokens: number; costUsd: number; unpriced: number }[]
  byOperation: { operation: string; calls: number; costUsd: number; unpriced: number }[]
  byDay:       { date: string;      calls: number; costUsd: number }[]
}

const EMPTY = (from: string, to: string): AiUsageSummary => ({
  from, to,
  totals: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, unpricedCalls: 0 },
  byModel: [], byOperation: [], byDay: [],
})

/**
 * Aggregate the ledger over a rolling window.
 *
 * Deliberately aggregates in JS rather than SQL: the row counts here are small (one per AI
 * call), and keeping it in code means the "unpriced" split stays visible instead of being
 * flattened by a SUM that treats NULL as zero.
 */
export async function getAiUsageSummary(days = 30): Promise<AiUsageSummary> {
  const to   = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10)

  try {
    const db = createAdminClient()
    const { data, error } = await db
      .from('ai_usage')
      .select('provider, model, operation, input_tokens, output_tokens, units, cost_usd, date')
      .gte('date', from)
      .lte('date', to)
      .limit(50_000)

    if (error) {
      console.warn('[ai/usage] summary unavailable (apply migration 213?):', error.message)
      return EMPTY(from, to)
    }

    type Row = {
      model: string; operation: string; date: string
      input_tokens: number; output_tokens: number; cost_usd: number | null
    }
    const rows = (data ?? []) as Row[]
    const summary = EMPTY(from, to)

    const models = new Map<string, AiUsageSummary['byModel'][number]>()
    const ops    = new Map<string, AiUsageSummary['byOperation'][number]>()
    const days_  = new Map<string, AiUsageSummary['byDay'][number]>()

    for (const row of rows) {
      const cost     = row.cost_usd == null ? 0 : Number(row.cost_usd)
      const unpriced = row.cost_usd == null ? 1 : 0

      summary.totals.calls        += 1
      summary.totals.inputTokens  += row.input_tokens  ?? 0
      summary.totals.outputTokens += row.output_tokens ?? 0
      summary.totals.costUsd      += cost
      summary.totals.unpricedCalls += unpriced

      const m = models.get(row.model) ?? { model: row.model, calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, unpriced: 0 }
      m.calls += 1; m.inputTokens += row.input_tokens ?? 0; m.outputTokens += row.output_tokens ?? 0
      m.costUsd += cost; m.unpriced += unpriced
      models.set(row.model, m)

      const o = ops.get(row.operation) ?? { operation: row.operation, calls: 0, costUsd: 0, unpriced: 0 }
      o.calls += 1; o.costUsd += cost; o.unpriced += unpriced
      ops.set(row.operation, o)

      const d = days_.get(row.date) ?? { date: row.date, calls: 0, costUsd: 0 }
      d.calls += 1; d.costUsd += cost
      days_.set(row.date, d)
    }

    const round = (n: number) => Number(n.toFixed(4))
    summary.totals.costUsd = round(summary.totals.costUsd)
    summary.byModel     = Array.from(models.values()).map(m => ({ ...m, costUsd: round(m.costUsd) })).sort((a, b) => b.costUsd - a.costUsd)
    summary.byOperation = Array.from(ops.values()).map(o => ({ ...o, costUsd: round(o.costUsd) })).sort((a, b) => b.costUsd - a.costUsd)
    summary.byDay       = Array.from(days_.values()).map(d => ({ ...d, costUsd: round(d.costUsd) })).sort((a, b) => a.date.localeCompare(b.date))

    return summary
  } catch (e) {
    console.warn('[ai/usage] summary threw:', e instanceof Error ? e.message : e)
    return EMPTY(from, to)
  }
}
