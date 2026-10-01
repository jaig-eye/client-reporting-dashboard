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
  resolveDfsCreds, resolveSeoConfig, dfsKeywordsForSite, dfsCompetitorDomains, dfsSerpCompetitors, dfsKeywordIdeas,
  dfsKeywordSuggestions, dfsLocalSerp, dfsLocalSearchVolume, isAggregatorDomain, normalizeDomain, readResearchLocation,
  type DfsKeywordCandidate, type DfsCreds, type SeoTrackingConfig, type ResearchLocation, type DfsSerpSnapshot,
  type DfsLocalVolume,
} from '@/lib/connectors/dataforseo'
import { toSerpInsight, patchKeywordMetadata } from './serpInsights'
import { parseServices, geoPhrase, buildResearchSeeds, rotatingWindow, researchTurn } from './researchSeeds'
import { splitPhrases } from './phrases'
import { canSpendOnDfs } from '@/lib/content/dfsBudget'
import { recordDfsUsage } from './dataforseoUsage'
import { deriveResearchLocation } from './deriveLocation'
import { brandMatcher } from './brandTerms'

/** How many competitors to mine. Each one costs a Labs task, and the fifth adds little. */
const MAX_COMPETITORS = 3
/**
 * Ranked keywords a site needs before domain overlap says anything useful.
 *
 * competitors_domain answers "who else ranks for what you rank for". Below roughly this many the
 * question has no content and the answer is just the vertical's biggest domains.
 */
const MIN_FOOTPRINT_FOR_OVERLAP = 25
/**
 * Service seeds probed with a live local SERP per run when there is a research location. $0.004
 * each. Which five rotates from run to run (rotatingWindow), so every service is probed in turn.
 */
const LOCAL_SERP_SEEDS = 5

/**
 * Services expanded per run (keyword ideas and local suggestions each). A bound on cost only, and
 * not on which services: the window rotates from run to run, so a client with twenty services has
 * every one of them expanded over four monthly runs rather than the first six forever. Two Labs
 * tasks per service, about two cents.
 */
const MAX_SERVICE_EXPANSIONS = 6

/**
 * How recently a tracked keyword must have had a live reading for the live checks to own it.
 *
 * The Labs snapshot is filed as desktop and dated today, and the current-rank view takes the newest
 * date with desktop first — so writing it over a keyword the rankings cron reads replaced a live,
 * local reading with a national one that lags weeks, and blanked its URL. 200 days covers the
 * slowest live cadence (182 days); a tracked keyword not read in that long — retired past two
 * years, or a money keyword the cron leaves alone — has only the snapshot, and still gets it.
 */
const LIVE_OWNED_DAYS = 200

/** Largest share of the stored pool that may come from competitors' rankings. */
const MAX_COMPETITOR_SHARE = 0.5
/**
 * Research older than this is redone by the monthly job; anything newer is reused as-is.
 *
 * A run is roughly 15–30 cents, so the saving matters less than stability: a candidate set that
 * shifted week to week would make the list a person picks from jump around, when what a content
 * plan wants is coherent coverage of a theme across several posts.
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
  /** The research location's name when the run was local, for the display to say so. */
  location?: string | null
  /** The best-rated businesses in the local pack for the seed services, when the run was local. */
  localPack?: Array<{ title: string; domain: string | null; rating: number | null; votes: number | null }>
  /** True when the deadline stopped the run before every paid call it planned had been made. */
  partial?: boolean
}

/** Which system a candidate came from. Stored as seo_keywords.source, so it must be honest. */
type KeywordOrigin = 'dataforseo' | 'ahrefs' | 'google_ads'

type Candidate = DfsKeywordCandidate & {
  normalized: string
  origin:     KeywordOrigin
  /** Google Ads volume in the research location. Undefined = not asked; null = asked, too small to report. */
  local_volume?: number | null
}

const normalize = (k: string) => k.trim().toLowerCase().replace(/\s+/g, ' ')

/** Filler that says nothing about what a business does. */
const SEED_STOP = new Set(['and', 'the', 'for', 'with', 'your', 'our', 'from', 'near', 'this', 'that', 'into', 'you', 'all'])

/**
 * How much of national demand this market is, from the phrases Google answered for both. The
 * median, over pairs big enough to be more than noise. 3% — roughly one large metro — when too
 * few answered to say.
 */
function observedLocalShare(cands: Candidate[]): number {
  const ratios = cands
    .filter(c => c.local_volume != null && c.local_volume > 0 && (c.search_volume ?? 0) >= 100)
    .map(c => (c.local_volume as number) / (c.search_volume as number))
    .sort((a, b) => a - b)
  if (ratios.length < 5) return 0.03
  return Math.min(1, Math.max(0.002, ratios[Math.floor(ratios.length / 2)]))
}

/**
 * Which of the client's services a keyword is about, if any.
 *
 * Needed because keyword_ideas is DataForSEO's CATEGORY expansion: for "landscape lighting
 * installation" the category is Lighting, whose biggest terms are "macbook stage light effect" and
 * "govee lights". The first real run for an outdoor-lighting installer stored three hundred of
 * those and nothing about outdoor lighting, so a result has to be about one of the services.
 *
 * Each service is matched on its own words. The words of every service used to be pooled, so a
 * keyword passed by borrowing one word from each of two unrelated services — "outdoor" from one,
 * "christmas" from another — and nothing recorded which service a keyword served. Now a keyword
 * must be about ONE service (two of its words, one of its word pairs, or one of its words plus the
 * market), and the service it matches best is returned so research can file it under that service.
 * A single-word service needs only its one word.
 */
export function buildSeedMatcher(phrases: string[], geo: string) {
  const tokenize = (v: string) =>
    v.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length >= 3 && !SEED_STOP.has(t))
  const geoTokens = new Set(tokenize(geo))
  // Word forms count as the same word: "lights" is "lighting", "landscaping" is "landscape". Without
  // this "landscaping lights installation near me" matched only "installation" and was thrown out.
  const stem = (w: string) => {
    for (const suffix of ['ings', 'ing', 'es', 's', 'ed', 'e']) {
      if (w.endsWith(suffix) && w.length - suffix.length >= 4) return w.slice(0, -suffix.length)
    }
    return w
  }
  const same = (a: string, b: string) =>
    a === b
    || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)))
    || (stem(a).length >= 4 && stem(a) === stem(b))
  const services = phrases.map(phrase => {
    const words = Array.from(new Set(tokenize(phrase).filter(x => !geoTokens.has(x))))
    const bigrams = new Set<string>()
    for (let i = 0; i + 1 < words.length; i++) bigrams.add(`${words[i]} ${words[i + 1]}`)
    return { phrase, words, bigrams }
  }).filter(s => s.words.length > 0)

  /** How strongly a keyword is about one service: 0 when it is not. */
  const strength = (t: string[], s: { words: string[]; bigrams: Set<string> }): number => {
    const hits = t.filter(x => s.words.some(w => same(x, w))).length
    let pair = false
    for (let i = 0; i + 1 < t.length; i++) if (s.bigrams.has(`${t[i]} ${t[i + 1]}`)) pair = true
    if (hits >= Math.min(2, s.words.length) || pair) return hits + (pair ? 1 : 0)
    if (hits >= 1 && t.some(x => geoTokens.has(x))) return 0.5
    return 0
  }
  const serviceOf = (kw: string): string | null => {
    const t = tokenize(kw)
    let best: string | null = null, bestScore = 0
    for (const s of services) {
      const score = strength(t, s)
      if (score > bestScore) { best = s.phrase; bestScore = score }
    }
    return best
  }
  return {
    mentionsGeo: (kw: string) => tokenize(kw).some(t => geoTokens.has(t)),
    isRelevant:  (kw: string) => serviceOf(kw) !== null,
    serviceOf,
  }
}
type SeedMatcher = ReturnType<typeof buildSeedMatcher>

/** Words that say "hire someone to do this" — the searches a service business wants to be found for. */
const SERVICE_WORDS = /\b(install(?:ation|ations|er|ers|ing)?|contractors?|compan(?:y|ies)|services?|near me|costs?|prices?|pricing|quotes?|estimates?|hire|professionals?|repairs?|maintenance|design(?:er|ers)?|specialists?|experts?)\b/
/** Words that say "buy this thing" — a product search, which a service business cannot rank for and should not write for. */
const PRODUCT_WORDS = /\b(buy|cheap(?:est)?|bulk|packs?|watts?|lumens?|bulbs?|batter(?:y|ies)|plug[- ]?in|kits?|sets?|reviews?|vs|sale|for sale|wholesale|diy|extension cords?|strips?|rgb|smart|fairy|string|rope|net|icicle|tree lights?|c[679]|testers?|fuses?|clips?|hooks?|timers?|dimmers?|sockets?|replacement|coupons?|discounts?|clearance)\b/
/** Retailers, marketplaces and shopping events. A search that names one is a search for a shop. */
const RETAILER_WORDS = /\b(amazon|prime day|walmart|home ?depot|lowe'?s|costco|wayfair|menards|ikea|etsy|ebay|temu|ace hardware|harbor freight|best buy|sam'?s club)\b/

/**
 * Never a content target, whatever the numbers: a search for a brand or a shop. Google's own
 * navigational label catches most brands ("govee outdoor lights"); the retailer list catches
 * the rest ("lowes christmas lights"). Dropped rather than demoted — a 450,000-a-month brand
 * term out-scored every service phrase even at -40.
 */
function isExcluded(c: Candidate): boolean {
  return String(c.intent ?? '').toLowerCase() === 'navigational' || RETAILER_WORDS.test(c.keyword.toLowerCase())
}

/**
 * Score a candidate so the pool arrives ordered by what is worth writing about.
 *
 * The score is STORED on the row (metadata.research_score) and every read of the pool sorts by
 * it, so what this function prefers is what topic selection sees first and what the wizard
 * shows at the top. It used to decide only which four hundred survived, and then every read
 * re-sorted by raw volume — which put "outdoor solar lights" (33,000 searches, Amazon's
 * customer) above "christmas light installation los angeles" (a few hundred, this client's).
 *
 * Weights, in the order they matter for a local service business:
 *   proven     up to +80   a paid term that converted — the client has already paid to learn it works
 *   volume     up to ~100  log-compressed hard: 100/mo scores 40, 100,000/mo scores 100
 *   branded        -40     navigational intent is someone who has already chosen a brand
 *   product        -30     buy / bulbs / kit / amazon — a shopping search
 *   service        +25     install / company / near me / cost — a hiring search
 *   local          +20     names the client's geography
 *   difficulty  up to -40  KD * 0.4
 *   owned          -50     we already rank top ten for it; it needs a supporting piece at most
 *   nearMiss       +25     we sit at 11–30; one good article can move it
 */
function score(c: Candidate, paidConversions: number, mentionsGeo: boolean, localShare = 0): number {
  const kw         = c.keyword.toLowerCase()
  // With a research location, demand is measured where the client sells. Google reports nothing
  // for a phrase whose local bucket is too small, so those fall back to the national figure scaled
  // by the share the answered phrases showed — a long-tail local phrase keeps its place instead of
  // dropping to zero.
  const demand = localShare > 0
    ? (c.local_volume ?? Math.round((c.search_volume ?? 0) * localShare))
    : (c.search_volume ?? 0)
  const volume     = Math.log10(Math.max(1, demand) + 1) * 20
  const difficulty = (c.keyword_difficulty ?? 50) * 0.4
  const proven     = paidConversions > 0 ? 40 + Math.min(40, paidConversions * 4) : 0
  const local      = mentionsGeo ? 20 : 0
  const service    = SERVICE_WORDS.test(kw) ? 25 : 0
  const product    = PRODUCT_WORDS.test(kw) ? -30 : 0
  const branded    = String(c.intent ?? '').toLowerCase() === 'navigational' ? -40 : 0
  // Only OUR position may adjust the score. A competitor row carries the competitor's rank in
  // the same field, so reading it unconditionally punished a keyword by 50 for a rival holding
  // it at #5 — precisely the keyword worth writing about — and rewarded one they held at #20.
  const ourPosition = c.source === 'competitor' ? null : c.position
  const owned      = ourPosition != null && ourPosition <= 10 ? -50 : 0
  const nearMiss   = ourPosition != null && ourPosition > 10 && ourPosition <= 30 ? 25 : 0
  return Math.round(volume - difficulty + proven + owned + nearMiss + local + service + product + branded)
}

/**
 * Discover keyword candidates for one client and store the unclaimed ones.
 *
 * Returns without touching anything when DataForSEO is not connected — the two database-backed
 * sources are still read, so a client without a connection gets a smaller pool rather than none.
 *
 * `deadline` (epoch ms) is when to stop STARTING paid calls. A call already in flight finishes and
 * is recorded, and whatever was found is stored as usual; the result says `partial`. Callers pass
 * one that leaves room for the slowest call (60s) and the storage after it inside their maxDuration.
 */
export async function discoverKeywords(clientId: string, opts: { deadline?: number } = {}): Promise<DiscoveryResult> {
  const empty: DiscoveryResult = { ok: false, discovered: 0, stored: 0, snapshotted: 0, bySource: {}, cost: 0, competitors: [] }
  // Hoisted so the competitor list survives the block that fetches it and can be returned.
  let competitorDomains: string[] = []
  // Built from the seeds once they are read; null on a run that never reaches them.
  let seedMatcher: SeedMatcher | null = null
  if (!clientId) return { ...empty, reason: 'no client' }

  const db = createAdminClient()

  // ── Spend: recorded call by call, and never started past the deadline ─────
  //
  // The ledger used to be written once, after every paid call had returned. A run killed by the
  // platform part-way — two dozen sequential calls with 30–60s timeouts each — recorded nothing:
  // invisible to the monthly ceiling, and with no freshness stamp either, so the same client was
  // first in line to be bought again the next day. Each call's cost now reaches the ledger as soon
  // as the call returns.
  let cost = 0
  let unrecorded = 0, unrecordedCalls = 0
  const onCost = (c: number) => { cost += c; unrecorded += c; unrecordedCalls++ }
  const flushCost = async () => {
    if (unrecorded <= 0) return
    const c = unrecorded, units = unrecordedCalls
    unrecorded = 0; unrecordedCalls = 0
    await recordDfsUsage({ operation: 'keyword_discovery', clientId, cost: c, units, date: new Date().toISOString().slice(0, 10) })
  }
  const deadline = opts.deadline ?? Infinity
  let cutShort = false
  /** One paid call: skipped past the deadline, recorded the moment it returns. */
  const paid = async <T>(call: () => Promise<T>, none: T): Promise<T> => {
    if (Date.now() >= deadline) { cutShort = true; return none }
    try { return await call() } finally { await flushCost() }
  }

  // ── The client's DataForSEO connection, if there is one ───────────────────
  let creds: DfsCreds | null = null
  let domain = ''
  let cfg: SeoTrackingConfig = resolveSeoConfig(null, null)
  try {
    // Active only: a paused connection is not billed by the rankings cron or picked by the monthly
    // job, and a button press must not be the one path that still spends through it.
    const { data, error } = await db
      .from('client_connections')
      .select('external_id, config, connector:connectors(type, auth, config)')
      .eq('client_id', clientId)
      .eq('status', 'active')
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
  const add = (c: DfsKeywordCandidate, origin: KeywordOrigin = 'dataforseo') => {
    const normalized = normalize(c.keyword)
    if (!normalized || normalized.length < 3) return
    const existing = candidates.get(normalized)
    // First source wins the metrics, but a later source can fill a gap the first left null.
    if (existing) {
      existing.search_volume      ??= c.search_volume
      existing.keyword_difficulty ??= c.keyword_difficulty
      existing.cpc                ??= c.cpc
      existing.intent             ??= c.intent
      // Never a competitor's position. A converting paid term arrives first with position null;
      // if the same keyword then comes back from a rival's ranked list at #5, filling the gap
      // here would hand score() the rival's rank as ours — and the guard in score() only reads
      // c.source, which is still 'idea'. That converting keyword the competitor owns is exactly
      // the one worth writing about, and it was being sent to the bottom of the pool.
      if (c.source !== 'competitor') existing.position ??= c.position
      return
    }
    candidates.set(normalized, { ...c, keyword: c.keyword.trim(), normalized, origin })
  }

  // ── Sources already in the database (free, and they work without DataForSEO) ──

  // The client's own name, so their brand can be told apart from what they sell.
  //
  // Paid search converts on the brand harder than on anything else — 5 Star Tuning's converting
  // terms were half its own name, in four spellings — and the scorer pays up to +80 for a term
  // that converted, so the list of things to write about opened with the company's own name.
  // Nothing is gained by an article aimed there: the searcher has already chosen the brand, and
  // the page that answers them is the home page, which exists. See brandTerms.ts for why the
  // match is as narrow as it is.
  const isBrand: (term: string) => boolean = await (async () => {
    const none = () => false
    try {
      const [{ data: client, error: clErr }, { data: svc, error: svcErr }] = await Promise.all([
        db.from('clients').select('name, website').eq('id', clientId).maybeSingle(),
        db.from('content_settings').select('services, geographic_focus').eq('client_id', clientId).maybeSingle(),
      ])
      // Unreadable is not "no brand": gating on a half-read name could catch a real keyword, so
      // an error means gate nothing at all. The services read matters as much as the name — it is
      // what keeps a name made of the service ("Irrigation Inc") from gating the service itself.
      if (clErr)  { console.warn('[research] cannot read the client name:', clErr.message); return none }
      if (svcErr) { console.warn('[research] cannot read services for the brand check:', svcErr.message); return none }
      const c = client as { name?: string | null; website?: string | null } | null
      const s = svc as { services?: string | null; geographic_focus?: string | null } | null
      return brandMatcher(c?.name, c?.website, s?.services, s?.geographic_focus)
    } catch { return none }
  })()

  const windowStart = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
  const paidConversions = new Map<string, number>()
  try {
    // Paged past PostgREST's 1,000-row cap: these sums feed score(), and a partial map under-credits
    // exactly the terms that convert most (they have the most rows).
    const data: { search_term: string; conversions: number | null }[] = []
    for (let from = 0; from < 20_000; from += 1000) {
      const { data: page, error } = await db
        .from('google_ads_search_terms')
        .select('search_term, conversions')
        .eq('client_id', clientId)
        .gte('date', windowStart)
        .gt('conversions', 0)
        .order('id', { ascending: true })
        .range(from, from + 999)
      if (error) { console.warn('[research] paid terms unavailable:', error.message); break }
      data.push(...((page ?? []) as { search_term: string; conversions: number | null }[]))
      if ((page ?? []).length < 1000) break
    }
    for (const r of data) {
      const term = String(r.search_term ?? '')
      const k = normalize(term)
      if (!k) continue
      paidConversions.set(k, (paidConversions.get(k) ?? 0) + (Number(r.conversions) || 0))
      // Counted, not added.
      //
      // A converting paid term is the best evidence there is that a SUBJECT sells — and the worst
      // possible article target. They are buying queries: "atv financing bad credit", "$0 down
      // motorcycle financing near me". The page that should rank for those is the client's own
      // financing page, and a blog post aimed at the same phrase competes with it. Canada
      // Powersports has 420 of them, and adding them put 392 transactional queries into a list
      // whose whole purpose is choosing what to write.
      //
      // So they stay out of the pool and keep their real job: paidConversions below feeds score(),
      // where a keyword found by research that ALSO converted in paid earns up to +80. That is the
      // signal worth having — proof that a subject makes money, applied to a keyword that is
      // actually writable. The terms themselves remain visible under Converted in paid, which is
      // reporting rather than a menu.
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
      }, 'ahrefs')
    }
  } catch { /* skip */ }

  // ── DataForSEO Labs (only when connected) ─────────────────────────────────
  // ownRanked is kept aside: those rows carry this client's own positions, and recording them is
  // the site-wide ranking snapshot.
  const ownRanked: DfsKeywordCandidate[] = []
  // ── Seeds: what the business sells, in the operator's words ─────────────────
  // Read before any DataForSEO call now, because competitors are found FROM the seeds (see
  // dfsSerpCompetitors) rather than from a domain overlap a new site does not have.
  let seeds: string[] = []
  let geo = ''
  let location: ResearchLocation | null = null
  // The client's service and place words, compacted and longest first — what a rival's domain
  // label is checked against before its terms are treated as that rival's brand.
  let genericWords: string[] = []
  // What the business sells, one entry per service (plus any older seed phrases), each expanded on
  // its own below so every service gets the same share of discovery.
  let researchServices: string[] = []
  // 0 until a local volume call has run; then the market's share of national demand.
  let localShare = 0
  // What Google showed for each probed seed, keyed by normalised seed; stored on the seed's row.
  const serpBySeed = new Map<string, DfsSerpSnapshot>()
  const packByTitle = new Map<string, { title: string; domain: string | null; rating: number | null; votes: number | null }>()
  try {
    // Asked for with the optional column, then without it. PostgREST fails the whole select
    // when foundational_keywords is missing (migration 222), which would silently drop the
    // keyword_ideas source — the one source that works for a client with no ranking history.
    // Asked for with both optional columns, then progressively without: research_location is
    // migration 224, foundational_keywords 222.
    const readSettings = (cols: string) => db.from('content_settings').select(cols).eq('client_id', clientId).maybeSingle()
    let { data: cs, error: csErr } = await readSettings('services, geographic_focus, foundational_keywords, research_location')
    if (csErr && /research_location/i.test(csErr.message)) {
      ;({ data: cs, error: csErr } = await readSettings('services, geographic_focus, foundational_keywords'))
    }
    if (csErr && /foundational_keywords/i.test(csErr.message)) {
      ;({ data: cs, error: csErr } = await readSettings('services, geographic_focus'))
    }
    if (csErr) console.warn('[research] cannot read services for seeds:', csErr.message)
    const settings = cs as Record<string, unknown> | null
    const services = parseServices(settings?.services)
    location = readResearchLocation(settings?.research_location)
    const geographicFocus = String(settings?.geographic_focus ?? '')
    genericWords = Array.from(new Set(
      [...services, geographicFocus, location?.name ?? '']
        .join(' ').toLowerCase().split(/[^a-z0-9]+/)
        .filter(w => w.length >= 3),
    )).sort((a, b) => b.length - a.length)

    // Nobody picked a research location, so read one out of the geography they already typed.
    //
    // This is the difference between finding the businesses down the road and listing the biggest
    // sites in the country: without a location the local SERP path below never runs at all. In
    // production none of the nineteen content clients has picked one and thirteen have written
    // their market in prose, so this is the normal case, not the exception.
    //
    // Derived, never stored: a guess and a decision must not share a field. The picker offers this
    // as a suggestion, and a human choice wins permanently once made.
    if (!location && creds && geographicFocus) {
      const derived = await deriveResearchLocation(geographicFocus, creds)
      if (derived) {
        location = derived.location
        console.log(`[research] research location derived from geographic_focus: "${derived.from}" → ${derived.location.name}`)
      } else {
        console.log(`[research] no local market read from geographic_focus ("${geographicFocus.slice(0, 60)}") — staying country-wide`)
      }
    }
    geo = geoPhrase(location, geographicFocus)
    // What the operator said this business should be found for, before any data existed. Seeds
    // only: they widen what gets discovered and then take no further part — the results are
    // ranked on volume, difficulty and proven paid conversions like everything else, so a term
    // typed at onboarding cannot quietly become the content plan.
    const foundational = (Array.isArray(settings?.foundational_keywords)
      ? settings.foundational_keywords as unknown[]
      : []
    ).map(v => String(v).trim()).filter(v => v.length > 2).slice(0, 25)
    // The geo variants matter twice over: they make the SERPs local, so the competitors found
    // are the ones down the road, and they give keyword_ideas a local angle to expand from.
    seeds = buildResearchSeeds(services, geo, foundational)
    {
      const seen = new Set<string>()
      researchServices = [...services, ...foundational].filter(s => {
        const k = s.toLowerCase().trim()
        if (!k || seen.has(k)) return false
        seen.add(k)
        return true
      })
    }
    // The location's every name part counts as geography for the matcher ("southern california"
    // is not a topic word), but the prose does not — a business that says "in-shop service at
    // 1820 Trade St" would have "shop" and "service" stop counting as topic words.
    seedMatcher = buildSeedMatcher([...foundational, ...services], [geo, ...(location ? location.name.split(',') : [])].join(' '))
  } catch { /* no settings — no seeds, and the sources below that need them are skipped */ }

  // Over the ceiling, discovery is skipped and the pool keeps whatever it already had — the same
  // degradation as having no connection, which everything downstream already handles.
  const withinBudget = creds && domain ? await canSpendOnDfs('keyword discovery') : true
  // Whether this run actually bought anything. The freshness stamp keys off it: a run stopped by
  // the budget never asked DataForSEO, so stamping it would say the market had been looked at and
  // hold the next real run behind the 30-day reuse window — long after the month rolled over and
  // the budget freed up.
  const spentOnDfs = !!creds && !!domain && withinBudget
  if (creds && domain && withinBudget) {
    const labsOpts = { locationCode: cfg.location_code, languageCode: cfg.language_code, onCost }
    // Narrowed once for the closures below.
    const dfs: DfsCreds = creds
    // Which services this run expands and probes. Rotates month by month so every service gets its
    // turn; see rotatingWindow.
    const turn = researchTurn()

    for (const c of await paid(() => dfsKeywordsForSite(domain, dfs, { ...labsOpts, source: 'site', limit: 300 }), [])) {
      ownRanked.push(c)
      add(c)
    }

    // ── Competitors: who ranks for the seeds, then who overlaps the domain ────
    // The seed SERPs come first because they answer the question for every client, including
    // one with no rankings yet. Domain overlap is kept as a supplement: once a site has a
    // footprint it can surface a rival the seeds did not, and it costs one call.
    // ── Local competitors: who a searcher in the service area actually sees ──
    // Labs serp_competitors answers nationally. With a research location, a few live SERPs of the
    // service seeds — organic top 20 plus the local pack — name the businesses down the road.
    let localRivals: string[] = []
    if (location && seeds.length) {
      const own   = normalizeDomain(domain)
      const tally = new Map<string, number>()
      const market = location
      // The plain seeds (the location code makes the search local), a rotating five of them.
      const probe = rotatingWindow(
        seeds.filter(sd => !geo || !sd.toLowerCase().endsWith(geo.toLowerCase())),
        LOCAL_SERP_SEEDS, turn,
      )
      let packs = 0
      for (const sd of probe) {
        const serp = await paid(() => dfsLocalSerp(sd, dfs, { locationCode: market.code, languageCode: cfg.language_code, depth: 20, onCost }), null)
        if (!serp) continue
        serpBySeed.set(normalize(sd), serp)
        // The seed itself belongs in the pool: it is what the operator said the business should be
        // found for, and it now carries what Google shows for it. Metrics fill in from the other
        // sources and the local volume call.
        add({ keyword: sd, search_volume: null, keyword_difficulty: null, cpc: null, competition: null, intent: null, source: 'idea', position: null, competitor_domain: null })
        for (const p of serp.localPack) {
          const prev = packByTitle.get(p.title.toLowerCase())
          if (!prev || (p.votes ?? 0) > (prev.votes ?? 0)) packByTitle.set(p.title.toLowerCase(), { title: p.title, domain: p.domain, rating: p.rating, votes: p.votes })
        }
        for (const o of serp.organic) {
          if (o.rank > 20 || o.domain === own || o.domain.endsWith('.' + own) || isAggregatorDomain(o.domain)) continue
          tally.set(o.domain, (tally.get(o.domain) ?? 0) + (21 - o.rank) / 20)
        }
        if (serp.localPack.length) packs++
        for (const p of serp.localPack) {
          if (!p.domain || p.domain === own || p.domain.endsWith('.' + own) || isAggregatorDomain(p.domain)) continue
          // In the pack at all outweighs any organic position: that is the map a local searcher
          // clicks first.
          tally.set(p.domain, (tally.get(p.domain) ?? 0) + 1.5)
        }
      }
      localRivals = Array.from(tally.entries()).sort((a, b) => b[1] - a[1]).map(([d]) => d).slice(0, 8)
      console.log(`[research] local SERPs (${location.name}): ${probe.length} seed(s), ${packs} with a local pack, ${localRivals.length} rival(s)` +
        (localRivals.length ? ` — top: ${localRivals.slice(0, 3).join(', ')}` : ''))
    }

    // The national lists are only bought when the local one has not answered.
    //
    // bySerp was already conditional; byOverlap was not, so a client with good local rivals still
    // had national brands appended to the set that gets displayed and mined.
    const localAnswered = localRivals.length >= 4
    const bySerp = seeds.length && !localAnswered
      ? await paid(() => dfsSerpCompetitors(seeds, dfs, { ...labsOpts, limit: 8, exclude: domain }), [])
      : []

    // Domain overlap compares what two sites both rank for, so it needs the client to rank for
    // something. A new site does not, and what comes back is then simply the biggest domains in
    // the vertical — the global brands that do not compete on this client's level. ownRanked is
    // the site's own ranked_keywords from earlier in this run, so the footprint is already known.
    const hasFootprint = ownRanked.length >= MIN_FOOTPRINT_FOR_OVERLAP
    const byOverlap = !localAnswered && hasFootprint
      ? await paid(() => dfsCompetitorDomains(domain, dfs, { ...labsOpts, limit: MAX_COMPETITORS }), [])
      : []
    if (!hasFootprint && !localAnswered) {
      console.log(`[research] domain overlap skipped: only ${ownRanked.length} ranked keyword(s) — too new for overlap to mean anything`)
    }
    const ordered   = Array.from(new Set([...localRivals, ...bySerp.map(c => c.domain), ...byOverlap]))
    competitorDomains = ordered.slice(0, 8)
    console.log(`[research] competitors: ${bySerp.length} from seed SERPs, ${byOverlap.length} from domain overlap` +
      (bySerp.length ? ` — top: ${bySerp.slice(0, 3).map(c => `${c.domain} (${c.keywords_count ?? '?'} kw)`).join(', ')}` : ''))

    for (const comp of ordered.slice(0, MAX_COMPETITORS)) {
      // A rival's own brand terms are theirs, not an opportunity: "jellyfish lighting cost" is
      // not a subject this client can rank for. Compared with spaces removed so a two-word
      // brand matches its one-word domain label.
      // The registrable label — "govee" from us.govee.com, not "us" — so the check actually
      // fires on a subdomain. And a rival's ranked list is its whole catalogue: a lighting
      // brand's includes humidifiers and gaming rooms. Only what is about this business joins.
      const parts = comp.split('.')
      const label = (parts.length >= 2 ? parts[parts.length - 2] : parts[0]).toLowerCase()
      // An exact-match domain is not a brand. austinplumbing.com's label is this client's own
      // market and service, and filtering on it dropped "austin plumbing repair" — the rival's best
      // terms are the client's best terms. The label is only a brand when something is left once
      // the client's service and place words are taken out of it.
      let rest = label
      for (const w of genericWords) rest = rest.split(w).join('')
      const labelIsBrand = label.length >= 4 && rest.length >= 3
      let skipped = 0, offTopic = 0
      for (const c of await paid(() => dfsKeywordsForSite(comp, dfs, { ...labsOpts, source: 'competitor', limit: 200 }), [])) {
        if (labelIsBrand && c.keyword.toLowerCase().replace(/\s+/g, '').includes(label)) { skipped++; continue }
        if (seedMatcher && !seedMatcher.isRelevant(c.keyword)) { offTopic++; continue }
        add(c)
      }
      if (skipped || offTopic) console.log(`[research] ${comp}: dropped ${skipped} brand term(s), ${offTopic} off-topic`)
    }

    // ── Ideas: the category expansion, filtered back to the business ──────────
    if (seeds.length && seedMatcher) {
      const matcher = seedMatcher
      // Filtered, unlike the domain and competitor sources: those are what real sites rank for,
      // this is a category guess and needs to prove it is about the business.
      //
      // One expansion per service, not one for all of them. A single call over every seed returned
      // whatever category had the most search volume — for a lighting installer, Christmas lights
      // — and the other services got the leftovers. Each service now gets its own equal share.
      // Every service matters as much as the next: the cap bounds cost per run, and the window
      // rotates so that over successive runs every service is expanded the same number of times.
      let kept = 0, dropped = 0
      const perService = rotatingWindow(researchServices, MAX_SERVICE_EXPANSIONS, turn)
      const batches = perService.length
        ? perService.map(s => (geo ? [s, `${s} ${geo}`] : [s]))
        : [seeds]
      const perBatch = Math.max(40, Math.floor(300 / batches.length))
      for (const batch of batches) {
        for (const c of await paid(() => dfsKeywordIdeas(batch, dfs, { ...labsOpts, limit: perBatch }), [])) {
          if (matcher.isRelevant(c.keyword)) { add(c); kept++ } else dropped++
        }
      }
      console.log(`[research] keyword_ideas: ${batches.length} expansion(s), kept ${kept}, dropped ${dropped} off-topic`)
    }

    // ── Local phrases: what people in this market actually type ─────────────
    // keyword_ideas cannot produce these — it expands by category and the city gets lost.
    // Phrase-match suggestions for the geo-suffixed seeds return only searches that contain the
    // seed, city included; "near me" is the other way a local searcher types it, the one that never
    // carries a city. One Labs task per seed, so the count is capped.
    //
    // One per service, in the service's own words: with the market pinned on when there is one,
    // "near me" when there is not. This used to take the first three geo seeds and the first two
    // near-me seeds, so the order services were typed in decided which got local phrases at all.
    // The same rotating window as the ideas above, so a service's turn brings both.
    if (seeds.length && seedMatcher) {
      const matcher = seedMatcher
      const localSeeds = rotatingWindow(researchServices, MAX_SERVICE_EXPANSIONS, turn)
        .map(s => (geo ? `${s} ${geo}` : `${s} near me`))
      let localKept = 0
      for (const sd of localSeeds) {
        for (const c of await paid(() => dfsKeywordSuggestions(sd, dfs, { ...labsOpts, limit: 60 }), [])) {
          if (matcher.isRelevant(c.keyword)) { add(c); localKept++ }
        }
      }
      console.log(`[research] local suggestions: ${localKept} from ${localSeeds.length} service seed(s)`)
    }

    // ── Local volume: what the service area itself searches ───────────────────
    // Every volume above is national — Labs is country-level by design. One Google Ads call prices
    // the pool for the research location, flat $0.09 whatever the count, so the ranking below can
    // put the market's demand ahead of the country's.
    if (location && candidates.size) {
      const byKey = new Map<string, Candidate>()
      // Up to 1,000 per task: the national order decides which make the cut when there are more.
      const prelim = Array.from(candidates.values())
        .sort((a, b) => score(b, paidConversions.get(b.normalized) ?? 0, seedMatcher?.mentionsGeo(b.keyword) ?? false)
                      - score(a, paidConversions.get(a.normalized) ?? 0, seedMatcher?.mentionsGeo(a.keyword) ?? false))
        .slice(0, 1000)
      for (const c of prelim) byKey.set(c.keyword.toLowerCase().replace(/\s+/g, ' '), c)
      const market = location
      const local = await paid(
        () => dfsLocalSearchVolume(Array.from(byKey.keys()), dfs, { locationCode: market.code, languageCode: cfg.language_code, onCost }),
        new Map<string, DfsLocalVolume>(),
      )
      let answered = 0
      for (const [k, v] of Array.from(local.entries())) {
        const c = byKey.get(k)
        if (!c) continue
        c.local_volume = v.search_volume
        c.cpc ??= v.cpc
        if (v.search_volume != null) answered++
      }
      if (local.size) localShare = observedLocalShare(Array.from(candidates.values()))
      console.log(`[research] local volume (${location.name}): ${answered} of ${byKey.size} answered, share ${(localShare * 100).toFixed(1)}%`)
    }
  }

  // Every paid call has already reached the ledger (see paid()); this only catches a cost reported
  // outside it, so nothing bought can leave the run unrecorded.
  await flushCost()
  if (cutShort) console.warn(`[research] client ${clientId}: deadline reached — later paid calls skipped, the rest is stored`)

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
    if (spentOnDfs && cost > 0) await stampResearchRun()
    return { ...empty, ok: true, cost: Number(cost.toFixed(4)), competitors: competitorDomains, reason: creds ? 'nothing discovered' : 'no DataForSEO connection and no local sources', ...(cutShort ? { partial: true } : {}) }
  }

  // ── Rank and trim ─────────────────────────────────────────────────────────
  const sortedAll = Array.from(candidates.values())
    .filter(c => !isExcluded(c))
    .map(c => ({ c, s: score(c, paidConversions.get(c.normalized) ?? 0, seedMatcher?.mentionsGeo(c.keyword) ?? false, localShare) }))
    .sort((a, b) => b.s - a.s)
  // At most half the pool from competitors' rankings, their weakest dropped first. Rivals rank for
  // everything in their own catalogue, so they out-number every other source; at one client 207 of
  // 242 keywords came from a handful of holiday-light installers, and the list read as theirs.
  const competitorCap = Math.floor(Math.min(MAX_CANDIDATES, sortedAll.length) * MAX_COMPETITOR_SHARE)
  const scored: typeof sortedAll = []
  let fromCompetitors = 0
  for (const r of sortedAll) {
    if (scored.length >= MAX_CANDIDATES) break
    if (r.c.source === 'competitor') {
      if (fromCompetitors >= competitorCap) continue
      fromCompetitors++
    }
    scored.push(r)
  }
  const ranked  = scored.map(r => r.c)
  const scoreOf = new Map(scored.map(r => [r.c.normalized, r.s] as const))

  const localPack = Array.from(packByTitle.values())
    .filter(p => p.title && !isAggregatorDomain(p.domain ?? ''))
    .sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0) || (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, 6)
  // ── Store, without disturbing anything a post already claimed ─────────────
  let stored = 0
  let storeFailed = false
  let snapshotted = 0
  const bySource: Record<string, number> = {}
  try {
    // Read in chunks: a single .in() of ~400 phrases is a URL long enough for the proxy to refuse,
    // and an unreadable list here used to mean inserting the whole batch into the unique key.
    const known = new Set<string>()
    const norms = ranked.map(c => c.normalized)
    for (let i = 0; i < norms.length; i += 100) {
      const { data: existing, error: existingErr } = await db
        .from('seo_keywords')
        .select('normalized_keyword')
        .eq('client_id', clientId)
        .in('normalized_keyword', norms.slice(i, i + 100))
      if (existingErr) console.warn('[research] cannot read existing keywords:', existingErr.message)
      for (const r of (existing ?? []) as { normalized_keyword: string }[]) known.add(r.normalized_keyword)
    }

    const rows = ranked.filter(c => !known.has(c.normalized)).map(c => ({
      client_id:          clientId,
      keyword:            c.keyword,
      normalized_keyword: c.normalized,
      // The system it actually came from. Every row used to say 'dataforseo', including the
      // Ads and Ahrefs rows a database-only run stores — which satisfied the created_at
      // freshness fallback and made an unconnected client look researched for 30 days, and
      // filed those rows under the DataForSEO badge in the Analytics tab.
      source:             c.origin,
      search_volume:      c.search_volume,
      keyword_difficulty: c.keyword_difficulty,
      cpc:                c.cpc,
      competition:        c.competition,
      // Brand searches are filed navigational wherever they came from.
      //
      // Applied here, at the one place every candidate is written, rather than per source — the
      // check started life on the Google Ads path, and those rows no longer reach the pool at all,
      // which would have left it doing nothing. DataForSEO is the source that needs it now: a
      // client's own ranked keywords always include their name. The pool read excludes
      // navigational intent and score() docks it 40, so this keeps brand terms out of the writer's
      // way through machinery that already exists, without deleting the row.
      intent:             isBrand(c.keyword) ? 'navigational' : c.intent,
      location_code:      cfg.location_code,
      language_code:      cfg.language_code,
      // The point of the pool: discovered, not yet chosen, and costing nothing to hold.
      is_tracked:         false,
      // The score, so reads can rank by it instead of by raw volume, and where the candidate
      // came from within the run (site / competitor / idea) for anyone reading the row later.
      metadata:           {
        research_score:    scoreOf.get(c.normalized) ?? null,
        found_via:         c.source,
        // The service this keyword is about, so the list can be read service by service instead
        // of as one pile ranked by volume. Null for a keyword that matched no single service
        // (the client's own rankings are kept without that test).
        service:           seedMatcher?.serviceOf(c.keyword) ?? null,
        // The market's own number, and where it was measured. Absent on a country-level run.
        ...(location ? { local_volume: c.local_volume ?? null, research_location: location.code } : {}),
        // What Google showed for a probed seed — the talking points, kept for the Analytics tab.
        ...(location && serpBySeed.has(c.normalized)
          ? { serp: toSerpInsight(serpBySeed.get(c.normalized) as DfsSerpSnapshot, { query: c.keyword, locationCode: location.code, location: location.name }) }
          : {}),
      },
    }))

    for (const c of ranked) bySource[c.source] = (bySource[c.source] ?? 0) + 1

    // Insert-or-skip on the table's own unique key, so a row the read above missed is skipped
    // rather than failing its whole chunk.
    for (let i = 0; i < rows.length; i += 200) {
      // .select() returns only the rows actually inserted, so skipped duplicates are not counted as new.
      const { data: inserted, error } = await db.from('seo_keywords').upsert(rows.slice(i, i + 200), {
        onConflict: 'client_id,normalized_keyword,location_code,language_code',
        ignoreDuplicates: true,
      }).select('id')
      if (error) { console.error('[research] insert failed:', error.message); storeFailed = true; break }
      stored += (inserted ?? []).length
    }

    // Paid for, discovered, and not kept. Reported as a failure — not stamped, so the next run
    // tries again — because "nothing found" would send the operator back to buy it again.
    if (rows.length > 0 && stored === 0 && storeFailed) {
      console.error('[research] nothing stored (apply migrations 189/222)')
      return { ...empty, ok: false, reason: 'storage failed', discovered: ranked.length, cost: Number(cost.toFixed(4)), competitors: competitorDomains, location: location?.name ?? null, localPack }
    }

    // Probed seeds that already had a row — tracked or claimed, so the reset left them — get
    // what Google showed for them and their local volume too.
    if (location) {
      for (const [norm, snap] of Array.from(serpBySeed.entries())) {
        if (!known.has(norm)) continue
        const c = candidates.get(norm)
        await patchKeywordMetadata(db, clientId, norm, {
          serp: toSerpInsight(snap, { query: norm, locationCode: location.code, location: location.name }),
          ...(c && c.local_volume !== undefined ? { local_volume: c.local_volume } : {}),
        })
      }
    }

    // The ranking snapshot, from rows already paid for.
    snapshotted = await recordOwnRankings(clientId, ownRanked)
  } catch (e) {
    // seo_keywords only exists from migration 189.
    console.warn('[discovery] cannot store candidates (apply migrations 189/190):', e)
    return { ...empty, ok: false, reason: 'seo_keywords unavailable', discovered: ranked.length, cost, competitors: competitorDomains }
  }

  // Stamped even when `stored` is 0. A well-covered client discovers nothing new for months, and
  // inferring freshness from row ages made that look like "never researched".
  //
  // Not stamped when the budget stopped the DataForSEO half, though: the database sources can
  // still produce candidates, and stamping on the strength of those would claim the market was
  // looked at when it was not — holding the next real run for thirty days after the month rolled
  // over and the money came back. Nor when every DataForSEO call failed or was refused (dead
  // credentials, empty balance, a bad location): a refusal is not billed (see labsAnswered), so
  // `cost > 0` means DataForSEO actually answered something, and without that a stamp would have
  // the monthly job skip the client for thirty days having learned nothing.
  //
  // A run the deadline cut short IS stamped. What it bought is stored and recorded, and re-running
  // it tomorrow would buy those same calls again; the services it did not reach come round in the
  // rotation.
  if (spentOnDfs && cost > 0) await stampResearchRun()

  console.log(`[research] client ${clientId}: ${ranked.length} candidates, ${stored} new, ${snapshotted} positions, $${cost.toFixed(4)}` + (cutShort ? ' (partial)' : ''))
  return {
    ok: true, discovered: ranked.length, stored, snapshotted, bySource, cost: Number(cost.toFixed(4)),
    competitors: competitorDomains, location: location?.name ?? null, localPack,
    ...(cutShort ? { partial: true, reason: 'stopped at the time limit; what was found is stored' } : {}),
  }
}

/**
 * Record this client's own positions from the ranked_keywords rows research already fetched.
 *
 * Every keyword needs a seo_keywords row to hang a ranking off, and research has just written
 * them, so this resolves ids by normalized keyword and upserts one snapshot per keyword.
 *
 * device 'desktop' because Labs data is desktop-based, and provider 'dataforseo_labs' so a
 * snapshot is never confused with a live check — they have very different freshness.
 *
 * Keywords the live checks own are left out (isLiveOwned): the current-rank view would otherwise
 * show this lagging national reading over their live one.
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
    // Chunked for the same URL-length reason as the store above.
    const keys = Array.from(byNormalized.keys())
    type KeywordRow = { id: string; normalized_keyword: string; is_tracked: boolean | null; last_checked_at: string | null }
    const data: KeywordRow[] = []
    for (let i = 0; i < keys.length; i += 100) {
      const { data: part, error } = await db
        .from('seo_keywords')
        .select('id, normalized_keyword, is_tracked, last_checked_at')
        .eq('client_id', clientId)
        .in('normalized_keyword', keys.slice(i, i + 100))
      if (error) { console.warn('[research] cannot resolve keyword ids for snapshot:', error.message); return 0 }
      data.push(...((part ?? []) as KeywordRow[]))
    }

    const today = new Date().toISOString().slice(0, 10)
    const now = Date.now()
    const rows = data
      .filter(k => !isLiveOwned(k, now))
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
      // Insert-or-skip. The live rank check writes the same (keyword, date, device) key, and its
      // reading is fresher than a Labs position that lags weeks — overwriting it replaced today's
      // real position and URL with a stale one and a null URL.
      const { data: kept, error } = await db.from('seo_rankings').upsert(chunk, { onConflict: 'keyword_id,date,device', ignoreDuplicates: true }).select('id')
      if (error) { console.error('[research] snapshot failed:', error.message); break }
      written += (kept ?? []).length
    }
    return written
  } catch (e) {
    // seo_rankings only exists from migration 190.
    console.warn('[research] cannot record positions (apply migration 190):', e)
    return 0
  }
}

/**
 * Whether the rankings cron's live checks own this keyword's readings: tracked, and read live
 * within LIVE_OWNED_DAYS. Those get no Labs snapshot. A tracked keyword the cron does not read — a
 * money keyword with no post, one retired past two years, one not yet published — still does, since
 * the snapshot is the only reading it gets.
 */
export function isLiveOwned(k: { is_tracked?: boolean | null; last_checked_at?: string | null }, now = Date.now()): boolean {
  if (k.is_tracked !== true || !k.last_checked_at) return false
  const t = Date.parse(k.last_checked_at)
  return Number.isFinite(t) && now - t < LIVE_OWNED_DAYS * 86_400_000
}

/** The Google Ads volume in the research location, stored by a local run. Null otherwise. */
export function localVolumeOf(metadata: unknown): number | null {
  const v = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>).local_volume : null
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** metadata.research_score as a number, or null for rows stored before the score was kept. */
export function researchScoreOf(metadata: unknown): number | null {
  const v = (metadata as Record<string, unknown> | null | undefined)?.research_score
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * The keywords topic selection may write about: the ones a person ticked in the Keywords tab.
 *
 * Read-only. Research is bought by the monthly job (/api/cron/keyword-research) and on an explicit
 * button press, never from here. `refreshed` is always false and stays for callers that log it.
 */
export async function getResearchCandidates(clientId: string): Promise<{
  candidates: Array<{ keyword: string; volume: number | null; difficulty: number | null; intent: string | null; score: number | null; local_volume: number | null }>
  refreshed:  boolean
}> {
  // Only chosen keywords reach the writer. A research run stores a few hundred candidates; they
  // stay browsable in the keywords panel, but nothing is written from one until a person picks it.
  //
  // Without migration 225 the filter is dropped and every candidate counts, which is the behaviour
  // this replaces — so an unmigrated database keeps working exactly as before.
  const read = async () => {
    const db = createAdminClient()
    const base = () => db
      .from('seo_keywords')
      .select('keyword, search_volume, keyword_difficulty, intent, metadata')
      .eq('client_id', clientId)
      .eq('is_tracked', false)
      .is('content_post_id', null)
    // Dismissed candidates stay out of the prompt. Asked with the filter, then without it, so a
    // database that has not run migration 223 still reads (and still shows dismissed rows —
    // there is nothing else it could do).
    // Chosen only, dismissed excluded. Each filter is dropped in turn if its column is absent,
    // so a database missing migration 225 (or 223) still reads and behaves as it did before that
    // migration — unfiltered, which is the old meaning of "the pool".
    let { data, error } = await base().not('chosen_at', 'is', null).is('dismissed_at', null).limit(200)
    if (error && /chosen_at/i.test(error.message)) {
      ({ data, error } = await base().is('dismissed_at', null).limit(200))
    }
    if (error && /dismissed_at/i.test(error.message)) ({ data, error } = await base().limit(200))
    if (error) console.warn('[research] candidate read failed:', error.message)
    // Sorted here, not in the query. keyword-sources/route.ts observed that a server-side
    // `.order('search_volume', { nullsFirst: false })` on this same select returned an empty
    // array with no error, and worked around it — but the same clause was left here, on the
    // one read that feeds the writer prompt. If the observation holds, this is the difference
    // between "researched opportunities" reaching topic selection and silently never doing so.
    return ((data ?? []) as Record<string, unknown>[]).map(r => ({
      keyword:    String(r.keyword ?? '').trim(),
      volume:     r.search_volume      == null ? null : Number(r.search_volume),
      difficulty: r.keyword_difficulty == null ? null : Number(r.keyword_difficulty),
      intent:     r.intent             == null ? null : String(r.intent),
      score:      researchScoreOf(r.metadata),
      local_volume: localVolumeOf(r.metadata),
    }))
      .filter(k => k.keyword)
      // By the research score, which is what the pool was built to prefer; volume breaks ties
      // and carries rows written before the score was stored.
      .sort((a, b) => (b.score ?? -1e9) - (a.score ?? -1e9) || (b.volume ?? -1) - (a.volume ?? -1))
      .slice(0, 40)
  }

  // Never buys research. It used to run discovery inline whenever what was stored had aged past the
  // window — from topic generation, once per slot, inside the cron's five-minute budget. Research
  // is now its own monthly job (/api/cron/keyword-research); topic selection only reads.
  return { candidates: await read(), refreshed: false }
}

/**
 * A function naming the service a stored keyword is about, for the lists that show the pool.
 *
 * Uses the service research recorded (metadata.service) when there is one, and otherwise matches
 * the keyword against the client's current services with the same rule research uses — so rows
 * stored before research recorded it group the same way. Returns null for no single service.
 */
export async function serviceTagger(clientId: string): Promise<{
  services: string[]
  serviceOf: (keyword: string, metadata?: unknown) => string | null
}> {
  const recorded = (metadata: unknown): string | null => {
    const v = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>).service : null
    return typeof v === 'string' && v.trim() ? v.trim() : null
  }
  try {
    const db = createAdminClient()
    const { data, error } = await db.from('content_settings')
      .select('services, geographic_focus')
      .eq('client_id', clientId)
      .maybeSingle()
    if (error) console.warn('[research] services unreadable for grouping:', error.message)
    const row = data as { services?: unknown; geographic_focus?: unknown } | null
    const services = parseServices(row?.services)
    if (!services.length) return { services, serviceOf: (_k, m) => recorded(m) }
    const matcher = buildSeedMatcher(services, splitPhrases(row?.geographic_focus).join(' '))
    return { services, serviceOf: (k, m) => recorded(m) ?? matcher.serviceOf(k) }
  } catch {
    return { services: [], serviceOf: (_k, m) => recorded(m) }
  }
}

/**
 * Whether research could buy anything for this client: an active DataForSEO connection with
 * credentials and a domain. A read failure answers no, which only ever means "don't throw the
 * current list away".
 */
export async function hasDfsConnection(clientId: string): Promise<boolean> {
  try {
    const db = createAdminClient()
    const { data, error } = await db
      .from('client_connections')
      .select('external_id, connector:connectors!inner(type, auth)')
      .eq('client_id', clientId)
      .eq('connector.type', 'dataforseo')
      .eq('status', 'active')
    if (error) { console.warn('[research] connection check failed:', error.message); return false }
    type Row = { external_id: string | null; connector: { auth?: Record<string, unknown> } | { auth?: Record<string, unknown> }[] | null }
    return ((data ?? []) as Row[]).some(r => {
      const conn = Array.isArray(r.connector) ? r.connector[0] : r.connector
      return !!(r.external_id ?? '').trim() && !!resolveDfsCreds(conn?.auth ?? {})
    })
  } catch {
    return false
  }
}

/**
 * When this client's research last spent, if within `withinMs` — read from the ledger, which a run
 * writes call by call, so a run still in progress already shows. For the button's cooldown.
 *
 * `error` set means the ledger could not be read; the caller must not treat that as "no spend".
 */
export async function recentResearchSpend(clientId: string, withinMs: number): Promise<{ at: string | null; error: string | null }> {
  try {
    const db = createAdminClient()
    const since = new Date(Date.now() - withinMs).toISOString()
    const { data, error } = await db
      .from('dataforseo_usage')
      .select('created_at')
      .eq('client_id', clientId)
      .eq('operation', 'keyword_discovery')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) return { at: null, error: error.message }
    const at = (data as { created_at?: string | null } | null)?.created_at
    return { at: at ? String(at) : null, error: null }
  } catch (e) {
    return { at: null, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Whether this client's research has aged past the reuse window, or never ran.
 *
 * A read failure answers "not due": re-running research on a guess costs money every time the
 * guess is wrong, while skipping it costs one day until the next cron pass asks again.
 */
export async function isResearchDue(clientId: string): Promise<boolean> {
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

    // A missing column (migration 222 not applied) must not mean "never research again". Fall
    // through to the row-age question, which is exactly the case the fallback below exists for.
    if (csErr && !/last_keyword_research_at/i.test(csErr.message)) {
      console.warn('[research] staleness check failed, treating research as current:', csErr.message)
      return false
    }
    if (csErr) console.warn('[research] last_keyword_research_at missing (apply migration 222) — falling back to row ages')

    const lastRun = csErr ? null : (cs as Record<string, unknown> | null)?.last_keyword_research_at
    if (lastRun) return String(lastRun) < cutoff

    // No timestamp yet: either this client has never been researched, or migration 222 has not
    // landed. Fall back to the row-age question so an existing pool is not re-bought on the first
    // pass after deploying — it is the weaker signal, but it only has to hold until the first run
    // writes a timestamp.
    const { data: fresh, error: freshErr } = await db
      .from('seo_keywords')
      .select('id')
      .eq('client_id', clientId)
      .eq('source', 'dataforseo')
      .gte('created_at', cutoff)
      .limit(1)
    if (freshErr) {
      console.warn('[research] staleness fallback failed, treating research as current:', freshErr.message)
      return false
    }
    return (fresh ?? []).length === 0
  } catch {
    // Table missing (migration 189 unapplied): nothing to refresh into.
    return false
  }
}


/**
 * Throw the candidate pool away so the next discovery rebuilds it from the current seeds.
 *
 * Discovery inserts unknown keywords only, so changing the seeds never removed what a previous
 * run had already stored — the operator could feed it better keywords and still be looking at
 * the old list. This is the other half of "re-run": it clears what research put there and
 * nothing else. Tracked keywords, keywords a post has claimed, and dismissed keywords all stay
 * — the first two belong to articles, and the third is a decision the next run must not undo.
 *
 * Rankings hanging off the removed candidates go with them (ON DELETE CASCADE). Returns how many
 * candidates were actually removed.
 */
export async function resetResearchPool(clientId: string): Promise<number> {
  if (!clientId) return 0
  const db = createAdminClient()
  try {
    // Which filters this database can take, so the DELETE below repeats exactly the ones the list used.
    let hasChosen = true, hasDismissed = true
    // Chosen keywords survive a re-run. Choosing sets chosen_at and nothing else — not
    // is_tracked, not content_post_id — so without this clause every keyword the operator had
    // picked was deleted by the next "Look again", while the UI promised the opposite.
    //
    // Read in pages, ordered by id. Research adds up to 400 rows a month, so a pool passes
    // PostgREST's 1,000-row cap within a few months, and a single read reset only the first
    // thousand while the rest of the old list stayed.
    const page = (from: number) => {
      let q = db
        .from('seo_keywords')
        .select('id')
        .eq('client_id', clientId)
        .eq('is_tracked', false)
        .is('content_post_id', null)
      if (hasDismissed) q = q.is('dismissed_at', null)
      if (hasChosen)    q = q.is('chosen_at', null)
      return q.order('id', { ascending: true }).range(from, from + 999)
    }
    let { data, error } = await page(0)
    if (error && /chosen_at/i.test(error.message)) { hasChosen = false; ({ data, error } = await page(0)) }
    if (error && /dismissed_at/i.test(error.message)) { hasDismissed = false; ({ data, error } = await page(0)) }
    if (error) { console.warn('[research] reset: cannot list candidates:', error.message); return 0 }
    const ids = ((data ?? []) as { id: string }[]).map(r => r.id)
    for (let from = 1000; (data ?? []).length === 1000 && from < 100_000; from += 1000) {
      ;({ data, error } = await page(from))
      if (error) { console.warn('[research] reset: cannot list candidates:', error.message); return 0 }
      ids.push(...((data ?? []) as { id: string }[]).map(r => r.id))
    }
    if (ids.length === 0) return 0
    let removed = 0
    for (let i = 0; i < ids.length; i += 200) {
      // The filters go on the DELETE as well as the list. A keyword ticked, claimed by a post or
      // dismissed between the two statements must survive, and only the delete can see that.
      // Rankings go with their keyword (ON DELETE CASCADE, in the migration and in production).
      let del = db.from('seo_keywords').delete()
        .in('id', ids.slice(i, i + 200))
        .eq('is_tracked', false)
        .is('content_post_id', null)
      if (hasChosen)    del = del.is('chosen_at', null)
      if (hasDismissed) del = del.is('dismissed_at', null)
      const { data: gone, error: delErr } = await del.select('id')
      if (delErr) { console.error('[research] reset: delete failed:', delErr.message); return removed }
      removed += (gone ?? []).length
    }
    console.log(`[research] reset pool for ${clientId}: removed ${removed} candidate(s)`)
    return removed
  } catch (e) {
    console.warn('[research] reset failed:', e)
    return 0
  }
}
