// Keywords the operator types in, rather than ones research found.
//
// WHY
//
// Research finds what it can see: what the site already ranks for, what rivals rank for, and what
// Google suggests around the services. None of that covers a term the operator simply knows about
// — a product line launching next month, the phrase a client's customers actually use on the
// phone, a competitor's brand worth writing a comparison against. Until now the only way in was to
// edit Services Offered and re-buy the whole research run.
//
// WHAT A MANUAL KEYWORD IS
//
// The same row as a discovered one, in the same pool, read by the same screens. Two differences:
//
//   source = 'manual'       so it is recognisable later, and so the research score's absence is
//                           explained rather than looking like a gap.
//   chosen_at = now()       typing a keyword in is choosing it. Nobody adds one by hand hoping it
//                           will not be used, and leaving it unchosen would hide it under sixty
//                           discovered rows sorted above it.
//
// is_tracked is written FALSE explicitly. The column defaults to true, and a tracked keyword is
// rank-checked on a schedule — roughly $0.10 a month each, forever. Discovery sets it false for
// exactly this reason. Tracking is what a written article earns, not what typing earns.

import type { createAdminClient } from '@/lib/supabase/server'
import {
  resolveDfsCreds, resolveSeoConfig, dfsKeywordOverview,
  type DfsCreds, type SeoTrackingConfig,
} from '@/lib/connectors/dataforseo'
import { canSpendOnDfs } from '@/lib/content/dfsBudget'
import { recordDfsUsage } from '@/lib/content/dataforseoUsage'

type Db = ReturnType<typeof createAdminClient>

/**
 * Per call. Matches the input box, so nothing is accepted on screen and then silently dropped on
 * the way in. A paste of a hundred is a research run, not a manual addition.
 */
const MAX_PER_CALL = 30

/** Same normalisation the pool and the selection endpoint use. */
function normalize(kw: string): string {
  return kw.trim().toLowerCase().replace(/\s+/g, ' ')
}

export interface AddResult {
  /** Rows inserted. */
  added:    number
  /** Already in the pool — chosen instead of duplicated. */
  rechosen: number
  /** Whether search volume and difficulty were looked up. */
  enriched: boolean
  cost:     number
  error?:   string
}

/**
 * Add hand-typed keywords to the client's pool and choose them.
 *
 * A keyword already in the pool is never duplicated — it is chosen and undismissed, which is what
 * someone typing it again plainly means.
 */
export async function addManualKeywords(
  db: Db,
  clientId: string,
  raw: string[],
): Promise<AddResult> {
  const none: AddResult = { added: 0, rechosen: 0, enriched: false, cost: 0 }
  // Deduplicated the way the table's unique key sees them. A case-sensitive Set let "Roof Repair"
  // and "roof repair" through as two rows with one normalized key, and the single insert then
  // failed the whole typed batch.
  const byNormal = new Map<string, string>()
  for (const k of raw.map(k => String(k ?? '').trim()).filter(k => k.length >= 2 && k.length <= 120)) {
    const n = normalize(k)
    if (n && !byNormal.has(n)) byNormal.set(n, k)
  }
  const wanted = Array.from(byNormal.values()).slice(0, MAX_PER_CALL)
  if (!clientId || wanted.length === 0) return none

  // Filed under the same location_code research writes: the connection's tracking config (a
  // country — Labs is country-level), NOT the research location. Research has always stored
  // cfg.location_code; this used to store the research location's city or county code instead,
  // which split one keyword across two codes and left registerKeyword to find it by fallback.
  //
  // Active connections only: a paused one is not billed anywhere else, so typing a keyword must not
  // be the one path that still spends through it.
  let creds: DfsCreds | null = null
  let cfg: SeoTrackingConfig = resolveSeoConfig(null, null)
  const { data: conns, error: connErr } = await db
    .from('client_connections')
    .select('config, connector:connectors(type, auth, config)')
    .eq('client_id', clientId)
    .eq('status', 'active')
  if (connErr) console.warn('[manual-keywords] cannot read connections:', connErr.message)
  type Row = {
    config: Record<string, unknown> | null
    connector: { type?: string; auth?: Record<string, unknown>; config?: Record<string, unknown> }
             | { type?: string; auth?: Record<string, unknown>; config?: Record<string, unknown> }[]
             | null
  }
  for (const row of (conns ?? []) as Row[]) {
    const conn = Array.isArray(row.connector) ? row.connector[0] : row.connector
    if (conn?.type !== 'dataforseo') continue
    creds = resolveDfsCreds(conn.auth ?? {})
    cfg   = resolveSeoConfig(conn.config, row.config)
    break
  }
  const locationCode = cfg.location_code

  // Already here? Then this is a choice, not an addition.
  const normalized = wanted.map(normalize)
  const { data: existing, error: exErr } = await db
    .from('seo_keywords')
    .select('id, normalized_keyword')
    .eq('client_id', clientId)
    .in('normalized_keyword', normalized)
  if (exErr) {
    // PostgREST returns failure in the payload. Unchecked, this would read as "nothing exists"
    // and insert duplicates of every keyword the pool already had.
    console.warn('[manual-keywords] cannot read existing:', exErr.message)
    return { ...none, error: 'Could not check the existing keywords' }
  }
  const have = new Set(((existing ?? []) as Array<{ normalized_keyword: string }>).map(r => r.normalized_keyword))

  let rechosen = 0
  if (have.size > 0) {
    const { error } = await db
      .from('seo_keywords')
      .update({ chosen_at: new Date().toISOString(), dismissed_at: null, updated_at: new Date().toISOString() })
      .eq('client_id', clientId)
      .in('normalized_keyword', Array.from(have))
    if (error) console.warn('[manual-keywords] cannot choose existing:', error.message)
    else rechosen = have.size
  }

  const fresh = wanted.filter(k => !have.has(normalize(k)))
  if (fresh.length === 0) return { ...none, rechosen }

  // Volume, difficulty and intent in one Labs call, so a typed keyword can be judged next to the
  // discovered ones instead of sitting among them with every column empty. One call for the whole
  // batch; skipped entirely when there is no connection, which simply leaves the columns null.
  let cost = 0
  const metrics = new Map<string, { volume: number | null; difficulty: number | null; intent: string | null }>()
  // The agency's monthly ceiling applies to this one call too. It is small — one Labs lookup per
  // batch — but a ceiling with exceptions is not a ceiling, and a keyword typed in past the budget
  // should land the same way it does for a client with no connection: added, without numbers.
  if (creds && !(await canSpendOnDfs('manual keyword metrics'))) creds = null
  if (creds) {
    try {
      const rows = await dfsKeywordOverview(fresh, creds, {
        locationCode: cfg.location_code, languageCode: cfg.language_code, onCost: c => { cost += c },
      })
      for (const r of rows) {
        metrics.set(normalize(r.keyword), {
          volume: r.search_volume, difficulty: r.keyword_difficulty, intent: r.intent ?? null,
        })
      }
    } catch (e) {
      // Metrics are a nicety; the keyword still gets added without them.
      console.warn('[manual-keywords] overview failed:', e instanceof Error ? e.message : e)
    }
    // Recorded as soon as it is bought, before the insert that can fail: it used to be written
    // after the insert, so a failed insert left a paid lookup out of the ledger and the ceiling.
    if (cost > 0) {
      await recordDfsUsage({
        operation: 'keyword_overview', clientId, cost, units: fresh.length,
        date: new Date().toISOString().slice(0, 10),
      })
    }
  }

  const now = new Date().toISOString()
  const rows = fresh.map(keyword => {
    const m = metrics.get(normalize(keyword))
    return {
      client_id:          clientId,
      keyword,
      normalized_keyword: normalize(keyword),
      source:             'manual',
      // Explicit: the column defaults to true, and tracking bills a rank check on a schedule.
      is_tracked:         false,
      // Typing it in is choosing it.
      chosen_at:          now,
      location_code:      locationCode,
      language_code:      cfg.language_code,
      search_volume:      m?.volume     ?? null,
      keyword_difficulty: m?.difficulty ?? null,
      intent:             m?.intent     ?? null,
      metadata:           { found_via: 'manual' },
    }
  })

  const { error: insErr } = await db.from('seo_keywords').insert(rows)
  if (insErr) {
    console.error('[manual-keywords] insert failed:', insErr.message)
    return { ...none, rechosen, cost: Number(cost.toFixed(4)), error: 'Could not save the keywords' }
  }

  console.log(`[manual-keywords] client ${clientId}: added ${rows.length}, rechose ${rechosen}, cost $${cost.toFixed(4)}`)
  return { added: rows.length, rechosen, enriched: metrics.size > 0, cost: Number(cost.toFixed(4)) }
}
