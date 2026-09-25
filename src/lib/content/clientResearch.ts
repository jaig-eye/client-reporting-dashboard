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
// TWO JOBS, ONE CALL
//
// ranked_keywords answers "what does this domain rank for", and every row it returns carries that
// keyword's POSITION. So the same call that seeds research is also a complete ranking snapshot of
// the site — broader than per-keyword tracking, because it covers pages nobody registered a
// keyword for. Recording it costs nothing extra.
//
// Those positions come from DataForSEO's index: refreshed weekly, over a SERP database that lags
// 30-90 days on low-popularity queries — which is most of what a local business ranks for. Good
// enough for a baseline, not good enough to tell whether last week's post is moving. Recent posts
// get a live check in the rankings cron for that.
//
// WHAT THIS DOES NOT DO
//
// Nothing here commissions a post. Candidates are a list for a person to choose from, not a
// queue. Rows already claimed by a post are never touched — a keyword's registration belongs to
// the article that targets it.
// ─────────────────────────────────────────────────────────────────────────────

import { createAdminClient } from '@/lib/supabase/server'
import {
  resolveDfsCreds, resolveSeoConfig, dfsKeywordsForSite, dfsCompetitorDomains, dfsKeywordIdeas,
  type DfsKeywordCandidate, type DfsCreds, type SeoTrackingConfig,
} from '@/lib/connectors/dataforseo'
import { recordDfsUsage } from './dataforseoUsage'

/** How many competitors to mine. Each one costs a Labs task, and the fifth adds little. */
const MAX_COMPETITORS = 3
/**
 * Research older than this is redone; anything newer is reused as-is.
 *
 * Six Labs calls is roughly six cents, so the saving is small — the real reason is stability.
 * Re-researching on every topic run would shift the candidate set week to week and make topic
 * selection jump around, when what a content plan wants is coherent coverage of a theme across
 * several posts.
 */
const RESEARCH_MAX_AGE_DAYS = 30
/** Ceiling on what one run will store, so a broad market can't write thousands of rows. */
const MAX_CANDIDATES = 400

export interface DiscoveryResult {
  ok:         boolean
  reason?:    string
  discovered: number
  stored:     number
  /** Own-domain positions recorded from the same ranked_keywords rows. */
  snapshotted: number
  bySource:   Record<string, number>
  cost:       number
  /**
   * The competitor domains DataForSEO named, carried out for display.
   *
   * Already paid for by the competitors_domain call inside this run — returning them costs
   * nothing and saves the setup wizard buying the same answer again to show it.
   */
  competitors: string[]
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
  // Only OUR position may adjust the score. A competitor row carries the competitor's rank in
  // the same field, so reading it unconditionally punished a keyword by 50 for a rival holding
  // it at #5 — precisely the keyword worth writing about — and rewarded one they held at #20.
  const ourPosition = c.source === 'competitor' ? null : c.position
  const owned      = ourPosition != null && ourPosition <= 10 ? -50 : 0
  const nearMiss   = ourPosition != null && ourPosition > 10 && ourPosition <= 30 ? 25 : 0
  return Math.round(volume - difficulty + proven + owned + nearMiss)
}

/**
 * Discover keyword candidates for one client and store the unclaimed ones.
 *
 * Returns without touching anything when DataForSEO is not connected — the two database-backed
 * sources are still read, so a client without a connection gets a smaller pool rather than none.
 */
export async function discoverKeywords(clientId: string): Promise<DiscoveryResult> {
  const empty: DiscoveryResult = { ok: false, discovered: 0, stored: 0, snapshotted: 0, bySource: {}, cost: 0, competitors: [] }
  // Hoisted so the competitor list survives the block that fetches it and can be returned.
  let competitorDomains: string[] = []
  if (!clientId) return { ...empty, reason: 'no client' }

  const db = createAdminClient()
  let cost = 0
  const onCost = (c: number) => { cost += c }

  // ── The client's DataForSEO connection, if there is one ───────────────────
  let creds: DfsCreds | null = null
  let domain = ''
  let cfg: SeoTrackingConfig = resolveSeoConfig(null, null)
  try {
    const { data, error } = await db
      .from('client_connections')
      .select('external_id, config, connector:connectors(type, auth, config)')
      .eq('client_id', clientId)
    // Without this, an unreadable connection is indistinguishable from "not connected" and the
    // client quietly gets database-only research forever.
    if (error) console.warn('[research] cannot read connections:', error.message)
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
    const { data, error } = await db
      .from('google_ads_search_terms')
      .select('search_term, conversions')
      .eq('client_id', clientId)
      .gte('date', windowStart)
      .gt('conversions', 0)
      .limit(2000)
    if (error) console.warn('[research] paid terms unavailable:', error.message)
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
    const { data, error } = await db
      .from('ahrefs_keywords')
      .select('keyword, position, volume, difficulty')
      .eq('client_id', clientId)
      .order('date', { ascending: false })
      .limit(500)
    if (error) console.warn('[research] ahrefs unavailable:', error.message)
    for (const r of (data ?? []) as { keyword: string; position: number | null; volume: number | null; difficulty: number | null }[]) {
      add({
        keyword: String(r.keyword ?? ''), search_volume: r.volume, keyword_difficulty: r.difficulty,
        cpc: null, competition: null, intent: null, source: 'site',
        position: r.position, competitor_domain: null,
      })
    }
  } catch { /* skip */ }

  // ── DataForSEO Labs (only when connected) ─────────────────────────────────
  // ownRanked is kept aside: those rows carry this client's own positions, and recording them is
  // the site-wide ranking snapshot.
  const ownRanked: DfsKeywordCandidate[] = []
  if (creds && domain) {
    const labsOpts = { locationCode: cfg.location_code, languageCode: cfg.language_code, onCost }

    for (const c of await dfsKeywordsForSite(domain, creds, { ...labsOpts, source: 'site', limit: 300 })) {
      ownRanked.push(c)
      add(c)
    }

    const competitors = await dfsCompetitorDomains(domain, creds, { ...labsOpts, limit: MAX_COMPETITORS })
    competitorDomains = competitors.slice()
    for (const comp of competitors) {
      for (const c of await dfsKeywordsForSite(comp, creds, { ...labsOpts, source: 'competitor', limit: 200 })) add(c)
    }

    // Seeds from what the client actually sells, so a domain with no history still produces a
    // list shaped like the business.
    try {
      // Asked for with the optional column, then without it. PostgREST fails the whole select
      // when foundational_keywords is missing (migration 222), which would silently drop the
      // keyword_ideas source — the one source that works for a client with no ranking history.
      let { data: cs, error: csErr } = await db
        .from('content_settings')
        .select('services, geographic_focus, foundational_keywords')
        .eq('client_id', clientId)
        .maybeSingle()
      if (csErr && /foundational_keywords/i.test(csErr.message)) {
        ;({ data: cs, error: csErr } = await db
          .from('content_settings')
          .select('services, geographic_focus')
          .eq('client_id', clientId)
          .maybeSingle())
      }
      // No seeds means no keyword_ideas call, which is the source that works for a client with no
      // ranking history — the one this whole path exists for.
      if (csErr) console.warn('[research] cannot read services for idea seeds:', csErr.message)
      const settings = cs as Record<string, unknown> | null
      const services = String(settings?.services ?? '')
        .split(/[,\n;]+/).map(v => v.trim()).filter(v => v.length > 2).slice(0, 12)
      const geo = String(settings?.geographic_focus ?? '').split(/[,\n;]+/)[0]?.trim() ?? ''
      // What the operator said this business should be found for, before any data existed. Seeds
      // only: they widen what gets discovered and then take no further part — the results are
      // ranked on volume, difficulty and proven paid conversions like everything else, so a term
      // typed at onboarding cannot quietly become the content plan.
      const foundational = (Array.isArray(settings?.foundational_keywords)
        ? settings.foundational_keywords as unknown[]
        : []
      ).map(v => String(v).trim()).filter(v => v.length > 2).slice(0, 25)
      const fromServices = geo ? services.flatMap(s => [s, `${s} ${geo}`]) : services
      const seeds = Array.from(new Set([...foundational, ...fromServices]))
      for (const c of await dfsKeywordIdeas(seeds, creds, { ...labsOpts, limit: 300 })) add(c)
    } catch { /* no settings — ideas skipped */ }
  }

  /**
   * Record that research ran, so the reuse gate has something truthful to read.
   *
   * Best-effort: the column arrives with migration 222, and a client whose settings row does not
   * exist yet simply updates nothing. Failing here must not fail the research that just succeeded.
   */
  const stampResearchRun = async () => {
    try {
      await db.from('content_settings')
        .update({ last_keyword_research_at: new Date().toISOString() })
        .eq('client_id', clientId)
    } catch { /* column or row missing — the gate falls back to row ages */ }
  }

  if (candidates.size === 0) {
    // A run that asked DataForSEO and got nothing back still answered the question, so it counts
    // against the 30-day window. A client with no connection has not been researched at all, so
    // it does not — otherwise connecting DataForSEO later would wait a month to take effect.
    if (creds) await stampResearchRun()
    return { ...empty, ok: true, competitors: competitorDomains, reason: creds ? 'nothing discovered' : 'no DataForSEO connection and no local sources' }
  }

  // ── Rank and trim ─────────────────────────────────────────────────────────
  const ranked = Array.from(candidates.values())
    .map(c => ({ c, s: score(c, paidConversions.get(c.normalized) ?? 0) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, MAX_CANDIDATES)
    .map(r => r.c)

  // ── Store, without disturbing anything a post already claimed ─────────────
  let stored = 0
  let snapshotted = 0
  const bySource: Record<string, number> = {}
  try {
    const { data: existing, error: existingErr } = await db
      .from('seo_keywords')
      .select('normalized_keyword')
      .eq('client_id', clientId)
      .in('normalized_keyword', ranked.map(c => c.normalized))
    // An empty result here reads as "we hold none of these", so a failure would insert the whole
    // batch again on every run.
    if (existingErr) console.warn('[research] cannot read existing keywords:', existingErr.message)
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
      if (error) { console.error('[research] insert failed:', error.message); break }
      stored += rows.slice(i, i + 200).length
    }

    // The ranking snapshot, from rows already paid for.
    snapshotted = await recordOwnRankings(clientId, ownRanked)
  } catch (e) {
    // seo_keywords only exists from migration 189.
    console.warn('[discovery] cannot store candidates (apply migrations 189/190):', e)
    return { ...empty, ok: false, reason: 'seo_keywords unavailable', discovered: ranked.length, cost, competitors: competitorDomains }
  }

  if (cost > 0) await recordDfsUsage({ operation: 'keyword_discovery', clientId, cost, units: ranked.length, date: new Date().toISOString().slice(0, 10) })

  // Stamped even when `stored` is 0. A well-covered client discovers nothing new for months, and
  // inferring freshness from row ages made that look like "never researched".
  await stampResearchRun()

  console.log(`[research] client ${clientId}: ${ranked.length} candidates, ${stored} new, ${snapshotted} positions, $${cost.toFixed(4)}`)
  return { ok: true, discovered: ranked.length, stored, snapshotted, bySource, cost: Number(cost.toFixed(4)), competitors: competitorDomains }
}

/**
 * Record this client's own positions from the ranked_keywords rows research already fetched.
 *
 * Every keyword needs a seo_keywords row to hang a ranking off, and research has just written
 * them, so this resolves ids by normalized keyword and upserts one snapshot per keyword.
 *
 * device 'desktop' because Labs data is desktop-based, and provider 'dataforseo_labs' so a
 * snapshot is never confused with a live check — they have very different freshness.
 */
async function recordOwnRankings(
  clientId: string,
  ownRanked: DfsKeywordCandidate[],
): Promise<number> {
  const ranked = ownRanked.filter(c => c.position != null && c.keyword.trim())
  if (ranked.length === 0) return 0
  try {
    const db = createAdminClient()
    const byNormalized = new Map(ranked.map(c => [normalize(c.keyword), c]))
    const { data, error } = await db
      .from('seo_keywords')
      .select('id, normalized_keyword')
      .eq('client_id', clientId)
      .in('normalized_keyword', Array.from(byNormalized.keys()))
    if (error) { console.warn('[research] cannot resolve keyword ids for snapshot:', error.message); return 0 }

    const today = new Date().toISOString().slice(0, 10)
    const rows = ((data ?? []) as { id: string; normalized_keyword: string }[])
      .map(k => {
        const c = byNormalized.get(k.normalized_keyword)
        if (!c) return null
        return {
          keyword_id:    k.id,
          client_id:     clientId,
          date:          today,
          device:        'desktop',
          position:      c.position,
          rank_absolute: null,
          url:           null,
          serp_features: null,
          search_volume: c.search_volume,
          provider:      'dataforseo_labs',
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)

    let written = 0
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200)
      const { error } = await db.from('seo_rankings').upsert(chunk, { onConflict: 'keyword_id,date,device' })
      if (error) { console.error('[research] snapshot failed:', error.message); break }
      written += chunk.length
    }
    return written
  } catch (e) {
    // seo_rankings only exists from migration 190.
    console.warn('[research] cannot record positions (apply migration 190):', e)
    return 0
  }
}

/**
 * Candidates for topic selection, researching first only when what we have has gone stale.
 *
 * This is the entry point topic selection calls. Reuse is the normal path: research runs at most
 * once every RESEARCH_MAX_AGE_DAYS per client, so the cost is a few cents a month and the
 * candidate set stays stable enough to plan a run of posts around.
 */
export async function getResearchCandidates(clientId: string): Promise<{
  candidates: Array<{ keyword: string; volume: number | null; difficulty: number | null; intent: string | null }>
  refreshed:  boolean
}> {
  const read = async () => {
    const { data } = await createAdminClient()
      .from('seo_keywords')
      .select('keyword, search_volume, keyword_difficulty, intent')
      .eq('client_id', clientId)
      .eq('is_tracked', false)
      .is('content_post_id', null)
      .order('search_volume', { ascending: false, nullsFirst: false })
      .limit(40)
    return ((data ?? []) as Record<string, unknown>[]).map(r => ({
      keyword:    String(r.keyword ?? '').trim(),
      volume:     r.search_volume      == null ? null : Number(r.search_volume),
      difficulty: r.keyword_difficulty == null ? null : Number(r.keyword_difficulty),
      intent:     r.intent             == null ? null : String(r.intent),
    })).filter(k => k.keyword)
  }

  try {
    const db = createAdminClient()
    const cutoff = new Date(Date.now() - RESEARCH_MAX_AGE_DAYS * 86_400_000).toISOString()

    // When research last RAN, not when a keyword was last stored.
    //
    // This used to ask whether any seo_keywords row was created inside the window, which only
    // tracks freshness while the pool is still growing. discoverKeywords() inserts unknown
    // keywords only, so a client whose market is well covered stores nothing, no row gets a new
    // created_at, and the gate reported "stale" on every call — six billable Labs calls per topic
    // generation rather than one run a month. The timestamp is written by the run itself.
    const { data: cs, error: csErr } = await db
      .from('content_settings')
      .select('last_keyword_research_at')
      .eq('client_id', clientId)
      .maybeSingle()

    // This one costs money to get wrong: a failure looks like "nothing recent", so research would
    // re-run its six Labs calls on every single topic generation instead of monthly.
    // A missing column (migration 222 not applied) must not mean "never research again". Fall
    // through to the row-age question, which is exactly the case the fallback below exists for.
    if (csErr && !/last_keyword_research_at/i.test(csErr.message)) {
      console.warn('[research] staleness check failed, reusing what is stored:', csErr.message)
      return { candidates: await read(), refreshed: false }
    }
    if (csErr) console.warn('[research] last_keyword_research_at missing (apply migration 222) — falling back to row ages')

    const lastRun = csErr ? null : (cs as Record<string, unknown> | null)?.last_keyword_research_at
    if (lastRun && String(lastRun) >= cutoff) return { candidates: await read(), refreshed: false }

    // No timestamp yet: either this client has never been researched, or migration 222 has not
    // landed. Fall back to the row-age question so an existing pool is not re-bought on the first
    // call after deploying — it is the weaker signal, but it only has to hold until the first run
    // writes a timestamp.
    if (lastRun == null) {
      const { data: fresh } = await db
        .from('seo_keywords')
        .select('id')
        .eq('client_id', clientId)
        .eq('source', 'dataforseo')
        .gte('created_at', cutoff)
        .limit(1)
      if ((fresh ?? []).length > 0) return { candidates: await read(), refreshed: false }
    }
  } catch {
    // Table missing (migration 189 unapplied) — research below will soft-fail the same way.
    return { candidates: [], refreshed: false }
  }

  await discoverKeywords(clientId)
  return { candidates: await read(), refreshed: true }
}
