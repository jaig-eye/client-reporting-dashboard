// ─────────────────────────────────────────────────────────────────────────────
// Keyword discovery — build a candidate pool, don't write anything with it.
//
// Topic selection reads GSC, which can only ever expand around queries the site already gets
// impressions for. A client who has never ranked for a service has nothing to expand from, and
// that is the weakest point in the whole pipeline: a new client is exactly who needs a keyword
// plan and exactly who cannot produce one.
//
// Five sources, three of them free because the data is already synced:
//   · what the domain ranks for            (DataForSEO ranked_keywords)
//   · what competitors rank for            (DataForSEO competitors_domain → ranked_keywords)
//   · expansions around the services       (DataForSEO keyword_ideas, seeded from Brand DNA)
//   · paid search terms that converted     (google_ads_search_terms — already in the database)
//   · organic positions from Ahrefs        (ahrefs_keywords — already in the database)
//
// WHAT THIS DOES NOT DO
//
// Nothing here starts tracking a keyword or commissions a post. Candidates land with
// is_tracked = false and no linked post, which is the whole point: discovery produces a list for
// a person to choose from. Tracking every candidate would multiply the rank-check bill by the
// size of a Labs response, and writing from every candidate would hand topic selection to
// whatever a keyword tool returned that morning.
//
// Rows already claimed by a post are never touched — a keyword's registration belongs to the
// article that targets it.
// ─────────────────────────────────────────────────────────────────────────────

import { createAdminClient } from '@/lib/supabase/server'
import {
  resolveDfsCreds, resolveSeoConfig, dfsKeywordsForSite, dfsCompetitorDomains, dfsKeywordIdeas,
  type DfsKeywordCandidate, type DfsCreds, type SeoTrackingConfig,
} from '@/lib/connectors/dataforseo'
import { recordDfsUsage } from './dataforseoUsage'

/** How many competitors to mine. Each one costs a Labs task, and the fifth adds little. */
const MAX_COMPETITORS = 3
/** Ceiling on what one run will store, so a broad market can't write thousands of rows. */
const MAX_CANDIDATES = 400

export interface DiscoveryResult {
  ok:         boolean
  reason?:    string
  discovered: number
  stored:     number
  bySource:   Record<string, number>
  cost:       number
}

type Candidate = DfsKeywordCandidate & { normalized: string }

const normalize = (k: string) => k.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Score a candidate so the pool arrives ordered by what is worth writing about.
 *
 * Deliberately simple and readable rather than tuned: volume carries it, difficulty subtracts,
 * and a term that converted in paid outranks both because the client has already proved someone
 * buys from it. A keyword we already rank well for scores low — it needs a supporting article at
 * most, not a new page.
 */
function score(c: Candidate, paidConversions: number): number {
  const volume     = Math.log10(Math.max(1, c.search_volume ?? 0) + 1) * 30
  const difficulty = (c.keyword_difficulty ?? 50) * 0.4
  const proven     = paidConversions > 0 ? 40 + Math.min(40, paidConversions * 4) : 0
  const owned      = c.position != null && c.position <= 10 ? -50 : 0
  const nearMiss   = c.position != null && c.position > 10 && c.position <= 30 ? 25 : 0
  return Math.round(volume - difficulty + proven + owned + nearMiss)
}

/**
 * Discover keyword candidates for one client and store the unclaimed ones.
 *
 * Returns without touching anything when DataForSEO is not connected — the two database-backed
 * sources are still read, so a client without a connection gets a smaller pool rather than none.
 */
export async function discoverKeywords(clientId: string): Promise<DiscoveryResult> {
  const empty: DiscoveryResult = { ok: false, discovered: 0, stored: 0, bySource: {}, cost: 0 }
  if (!clientId) return { ...empty, reason: 'no client' }

  const db = createAdminClient()
  let cost = 0
  const onCost = (c: number) => { cost += c }

  // ── The client's DataForSEO connection, if there is one ───────────────────
  let creds: DfsCreds | null = null
  let domain = ''
  let cfg: SeoTrackingConfig = resolveSeoConfig(null, null)
  try {
    const { data } = await db
      .from('client_connections')
      .select('external_id, config, connector:connectors(type, auth, config)')
      .eq('client_id', clientId)
    type Row = {
      external_id: string | null
      config: Record<string, unknown> | null
      connector: { type?: string; auth?: Record<string, unknown>; config?: Record<string, unknown> }
               | { type?: string; auth?: Record<string, unknown>; config?: Record<string, unknown> }[]
               | null
    }
    for (const row of (data ?? []) as Row[]) {
      const conn = Array.isArray(row.connector) ? row.connector[0] : row.connector
      if (conn?.type !== 'dataforseo') continue
      creds  = resolveDfsCreds(conn.auth ?? {})
      domain = (row.external_id ?? '').trim()
      cfg    = resolveSeoConfig(conn.config, row.config)
      break
    }
  } catch {
    // Connections unreadable — fall through to the database-only sources.
  }

  const candidates = new Map<string, Candidate>()
  const add = (c: DfsKeywordCandidate) => {
    const normalized = normalize(c.keyword)
    if (!normalized || normalized.length < 3) return
    const existing = candidates.get(normalized)
    // First source wins the metrics, but a later source can fill a gap the first left null.
    if (existing) {
      existing.search_volume      ??= c.search_volume
      existing.keyword_difficulty ??= c.keyword_difficulty
      existing.cpc                ??= c.cpc
      existing.intent             ??= c.intent
      existing.position           ??= c.position
      return
    }
    candidates.set(normalized, { ...c, keyword: c.keyword.trim(), normalized })
  }

  // ── Sources already in the database (free, and they work without DataForSEO) ──
  const windowStart = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
  const paidConversions = new Map<string, number>()
  try {
    const { data } = await db
      .from('google_ads_search_terms')
      .select('search_term, conversions')
      .eq('client_id', clientId)
      .gte('date', windowStart)
      .gt('conversions', 0)
      .limit(2000)
    for (const r of (data ?? []) as { search_term: string; conversions: number | null }[]) {
      const k = normalize(String(r.search_term ?? ''))
      if (!k) continue
      paidConversions.set(k, (paidConversions.get(k) ?? 0) + (Number(r.conversions) || 0))
      add({
        keyword: String(r.search_term), search_volume: null, keyword_difficulty: null, cpc: null,
        competition: null, intent: 'transactional', source: 'idea', position: null, competitor_domain: null,
      })
    }
  } catch { /* table missing or unreadable — skip this source */ }

  try {
    const { data } = await db
      .from('ahrefs_keywords')
      .select('keyword, position, volume, difficulty')
      .eq('client_id', clientId)
      .order('date', { ascending: false })
      .limit(500)
    for (const r of (data ?? []) as { keyword: string; position: number | null; volume: number | null; difficulty: number | null }[]) {
      add({
        keyword: String(r.keyword ?? ''), search_volume: r.volume, keyword_difficulty: r.difficulty,
        cpc: null, competition: null, intent: null, source: 'site',
        position: r.position, competitor_domain: null,
      })
    }
  } catch { /* skip */ }

  // ── DataForSEO Labs (only when connected) ─────────────────────────────────
  if (creds && domain) {
    const labsOpts = { locationCode: cfg.location_code, languageCode: cfg.language_code, onCost }

    for (const c of await dfsKeywordsForSite(domain, creds, { ...labsOpts, source: 'site', limit: 300 })) add(c)

    const competitors = await dfsCompetitorDomains(domain, creds, { ...labsOpts, limit: MAX_COMPETITORS })
    for (const comp of competitors) {
      for (const c of await dfsKeywordsForSite(comp, creds, { ...labsOpts, source: 'competitor', limit: 200 })) add(c)
    }

    // Seeds from what the client actually sells, so a domain with no history still produces a
    // list shaped like the business.
    try {
      const { data: cs } = await db
        .from('content_settings')
        .select('services, geographic_focus')
        .eq('client_id', clientId)
        .maybeSingle()
      const services = String((cs as Record<string, unknown> | null)?.services ?? '')
        .split(/[,\n;]+/).map(v => v.trim()).filter(v => v.length > 2).slice(0, 12)
      const geo = String((cs as Record<string, unknown> | null)?.geographic_focus ?? '').split(/[,\n;]+/)[0]?.trim() ?? ''
      const seeds = geo ? services.flatMap(s => [s, `${s} ${geo}`]) : services
      for (const c of await dfsKeywordIdeas(seeds, creds, { ...labsOpts, limit: 300 })) add(c)
    } catch { /* no settings — ideas skipped */ }
  }

  if (candidates.size === 0) {
    return { ...empty, ok: true, reason: creds ? 'nothing discovered' : 'no DataForSEO connection and no local sources' }
  }

  // ── Rank and trim ─────────────────────────────────────────────────────────
  const ranked = Array.from(candidates.values())
    .map(c => ({ c, s: score(c, paidConversions.get(c.normalized) ?? 0) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, MAX_CANDIDATES)
    .map(r => r.c)

  // ── Store, without disturbing anything a post already claimed ─────────────
  let stored = 0
  const bySource: Record<string, number> = {}
  try {
    const { data: existing } = await db
      .from('seo_keywords')
      .select('normalized_keyword')
      .eq('client_id', clientId)
      .in('normalized_keyword', ranked.map(c => c.normalized))
    const known = new Set(((existing ?? []) as { normalized_keyword: string }[]).map(r => r.normalized_keyword))

    const rows = ranked.filter(c => !known.has(c.normalized)).map(c => ({
      client_id:          clientId,
      keyword:            c.keyword,
      normalized_keyword: c.normalized,
      source:             'dataforseo',
      search_volume:      c.search_volume,
      keyword_difficulty: c.keyword_difficulty,
      cpc:                c.cpc,
      competition:        c.competition,
      intent:             c.intent,
      location_code:      cfg.location_code,
      language_code:      cfg.language_code,
      // The point of the pool: discovered, not yet chosen, and costing nothing to hold.
      is_tracked:         false,
    }))

    for (const c of ranked) bySource[c.source] = (bySource[c.source] ?? 0) + 1

    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db.from('seo_keywords').insert(rows.slice(i, i + 200))
      if (error) { console.error('[discovery] insert failed:', error.message); break }
      stored += rows.slice(i, i + 200).length
    }
  } catch (e) {
    // seo_keywords only exists from migration 189.
    console.warn('[discovery] cannot store candidates (apply migrations 189/190):', e)
    return { ...empty, ok: false, reason: 'seo_keywords unavailable', discovered: ranked.length, cost }
  }

  if (cost > 0) await recordDfsUsage({ operation: 'keyword_discovery', clientId, cost, units: ranked.length, date: new Date().toISOString().slice(0, 10) })

  console.log(`[discovery] client ${clientId}: ${ranked.length} candidates, ${stored} new, $${cost.toFixed(4)}`)
  return { ok: true, discovered: ranked.length, stored, bySource, cost: Number(cost.toFixed(4)) }
}

/**
 * How many unclaimed candidates a client still has.
 *
 * Drives the refill trigger: discovery runs when the pool is thin rather than on a calendar, so a
 * client publishing twice a week refills sooner than one publishing monthly, with no rule to tune.
 */
export async function unclaimedPoolSize(clientId: string): Promise<number> {
  try {
    const db = createAdminClient()
    const { count } = await db
      .from('seo_keywords')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('is_tracked', false)
      .is('content_post_id', null)
    return count ?? 0
  } catch {
    return 0
  }
}
