// ─────────────────────────────────────────────────────────────────────────────
// Free stock-photo candidates for a post's featured image.
//
// An alternative to AI generation, not a replacement: the reviewer picks a real
// photograph when one genuinely fits, and keeps the generated image when none does.
//
// THREE SOURCES, BECAUSE THEY FAIL IN DIFFERENT PLACES
//   • Pexels   — modern commercial stock, by far the highest quality, and the only one
//                that covers industrial/B2B subjects well. Needs a free API key; absent,
//                it self-skips and the other two still run.
//   • Openverse — ~700M CC images, mostly Flickr. Strong on consumer/outdoor subjects.
//   • Wikimedia Commons — reference and documentary photography. Strong on technical
//                subjects. No key.
// Measured on the live APIs, "powder coating oven" returns: Palak Paneer and baked
// aubergine from Openverse, a public-domain oven interior from Commons, and three
// 6000x4000 frames of a technician applying powder coating from Pexels.
//
// RELEVANCE IS THE WHOLE PROBLEM AND IT IS HANDLED HERE
// These APIs OR the query terms across large general corpora, so a niche query returns
// confident nonsense. Candidates must clear both a ratio floor AND an absolute minimum
// number of matched terms. Returning NOTHING is always better than returning a
// plausible wrong photo — a reviewer shown six irrelevant images stops trusting the
// feature — so the bar is never lowered to fill slots.
//
// QUERY LADDER
// Long queries are the other half of the recall problem: Commons found 1 photo for
// "powder coating oven" and 10 for "powder coating". Queries are tried specific-first
// and progressively shortened, stopping once enough DISTINCT candidates exist. Every
// rung is still derived from THIS post's topic, never the client's industry — an
// earlier version fell back to the industry and a powder-coating article filled every
// slot with photos of school metalwork students that scored perfectly against "metal
// fabrication". An industry is not a subject.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'

const OPENVERSE_ENDPOINT = 'https://api.openverse.org/v1/images/'
const COMMONS_ENDPOINT   = 'https://commons.wikimedia.org/w/api.php'
const REQUEST_TIMEOUT_MS = 6000
/** Fraction of the query's meaningful terms that must appear in title/tags. */
const RELEVANCE_FLOOR = 0.5
/**
 * Absolute number of terms that must match, independent of the ratio.
 *
 * Without this the bar silently HALVES as the ladder shortens the query: the score is
 * hits/terms.length, so the requirement falls from 4-of-8 to 2-of-3 to 1-of-2 while the
 * floor stays at 0.5. A photo captioned "Baking powder, flour and sugar for blondies"
 * scores exactly 0.5 against the rung "powder coating" and was admitted — the very
 * result this module exists to reject.
 */
const MIN_TERM_HITS   = 2
/**
 * Extra relevance a SINGLE-TERM rung must clear.
 *
 * With one term the absolute minimum collapses to 1 and the ratio is 1/1, so every
 * caption containing that word scores a perfect 1.00 — including, for the rung "table",
 * every dining table on Pexels. The rung still earns its place on narrow topics where
 * nothing else returns anything, so it is not removed; it just has to match the word in
 * a title rather than anywhere in a tag soup, which is what this threshold buys.
 */
const SINGLE_TERM_FLOOR = 1.0
/**
 * How many candidates one automatic search banks.
 *
 * Generation happens once per post; review happens repeatedly. So it is worth banking a
 * POOL rather than the handful the strip shows, because every look through that pool
 * afterwards is then free — no upstream call, no quota, and nothing that can fail while
 * a reviewer is waiting. Pexels' free tier is 200 requests/HOUR, and a backlog cron run
 * generating 15 posts concurrently is exactly the burst that can reach it.
 */
const MAX_CANDIDATES  = 40
/**
 * Rungs of the query ladder an automatic search is allowed to spend.
 *
 * The ladder can be up to 9 rungs across 3 seeds, and each rung costs one call PER
 * SOURCE — so an unbounded run was up to 27 upstream calls for a single post, and the
 * cost peaked precisely on the niche topics that yield nothing. Three rungs is the
 * specific phrase plus two progressively broader ones, which is where essentially all
 * of the recall comes from. Bounded: 9 calls, worst case, per post.
 */
const MAX_RUNGS       = 4
/** Below this, an image is a thumbnail, icon or diagram rather than a usable photo. */
const MIN_WIDTH  = 600
const MIN_HEIGHT = 400

const USER_AGENT = 'client-reporting-dashboard/1.0 (+https://dash.golaunchlocal.com)'

/** Grammar words: no visual meaning, and they inflate the score for free. */
const STOP_WORDS = new Set([
  'the','a','an','of','for','and','to','in','on','with','your','you','how','what','why',
  'is','are','was','were','be','best','guide','tips','need','know','should','can','do',
  'does','vs','versus','when','which','from','that','this','it','its','about','into',
  'complete','ultimate','top','right','choose','choosing','before','after','made','make',
  'requirements','checklist','explained','everything','common','things','ways','steps',
])

/**
 * Words that are real nouns but CANNOT BE PHOTOGRAPHED, plus the framing vocabulary SEO
 * titles are built from.
 *
 * This is the difference between a useful query and a useless one, and the old code had
 * no equivalent — it just took the first two meaningful words, which are almost always
 * the abstract ones. Measured against live production keywords:
 *
 *   "signs irrigation system needs repair"  ->  "signs irrigation"  ->  irrigation SIGNAGE
 *   "spring sprinkler system start-up …"    ->  "spring sprinkler"  ->  Spring Grove Cemetery
 *
 * Stripping these first leaves "irrigation repair" and "sprinkler", which are things a
 * camera can point at. Seasons are included because they read as the season, not the
 * component — "spring" is what pulled in the cemetery.
 */
const NON_VISUAL_WORDS = new Set([
  // framing / article vocabulary
  'signs','sign','warning','checklist','guide','tips','ideas','idea','options','option',
  'benefits','mistakes','factors','considerations','questions','answers','reasons',
  'comparison','differences','difference','explained','overview','introduction',
  'cost','costs','price','pricing','prices','budget','value','worth','cheap','affordable',
  'process','method','methods','solution','solutions','approach',
  // generic abstractions that survive the grammar list
  'system','systems','service','services','type','types','style','styles','size','sizes',
  'quality','issue','issues','problem','problems','tip','fact','facts','list',
  // audience / possessive framing
  'homeowner','homeowners','business','businesses','owner','owners','buyer','buyers',
  'customer','customers','client','clients','company','companies','shop','shops',
  // seasonal — reads as the season, not the component
  'spring','summer','autumn','fall','winter','seasonal','season',
  // temporal / vague qualifiers
  'new','old','modern','latest','today','year','years','month','months','day','days',
  'start','startup','begin','beginning','end','final',
  // geography. The client's own service area is stripped separately, but the keyword
  // often names a place the service-area field spells differently — "…checklist Florida"
  // against a geographic_focus of "Melbourne, FL and Brevard County" left "florida" in
  // the query, and "sprinkler florida" returned Florida pastures and rest areas.
  'county','city','town','area','areas','region','local','nearby','near','me',
  'alabama','alaska','arizona','arkansas','california','colorado','connecticut',
  'delaware','florida','georgia','hawaii','idaho','illinois','indiana','iowa','kansas',
  'kentucky','louisiana','maine','maryland','massachusetts','michigan','minnesota',
  'mississippi','missouri','montana','nebraska','nevada','hampshire','jersey','mexico',
  'york','carolina','dakota','ohio','oklahoma','oregon','pennsylvania','rhode',
  'tennessee','texas','utah','vermont','wisconsin','wyoming',
  'usa','america','american','national','northern','southern','eastern','western',
  // NOT listed, deliberately, despite being state names: 'island' (Rhode Island),
  // 'washington' and 'virginia'. Each is a common subject word — an island kitchen, a
  // washington-named business, virginia creeper — and stripping it would delete the
  // subject to remove a place. The remaining half of those names ('rhode') is enough to
  // neutralise the pair, and the client's own geographic_focus is stripped separately.
  // verbs. These survive the grammar list and, being early in a question-shaped
  // keyword, used to become the query: "how to tell if irrigation system is leaking"
  // searched for "tell" and returned tarot cards and archaeological tells.
  'tell','telling','improve','improving','boost','boosting','avoid','avoiding','prevent',
  'save','saving','understand','compare','comparing','pick','picking','find','finding',
  'get','getting','use','using','install','maintain','maintaining','handle','ensure',
  'consider','considering','decide','deciding','identify','spot','spotting','reduce',
  'needs','need','much','many','long','last','lasts','expect','remove','removing','open',
  'close','closing','hard','easy','prepare','preparing','buy','buying','sell','selling',
  'work','works','working','look','looks','looking','keep','keeping','take','takes',
])

/** Which library a candidate came from. Distinct from `provider`, which is the UPSTREAM
 *  host Openverse aggregated it from ('flickr', 'museumsvictoria', …) and is therefore
 *  useless for ranking or labelling. */
export type StockSource = 'pexels' | 'openverse' | 'wikimedia'

export interface StockImageCandidate {
  id:          string
  source:      StockSource
  title:       string
  url:         string
  thumbnail:   string
  creator:     string | null
  license:     string
  licenseUrl:  string | null
  sourceUrl:   string | null
  /** Upstream host, for display detail only. */
  provider:    string | null
  width:       number | null
  height:      number | null
  attribution: string | null
  relevance:   number
  matchedQuery: string
}

/**
 * True when the word, or its singular form, appears in either exclusion list.
 *
 * The lists carry singulars, so "needs" slipped past 'need' and became half a query:
 * the rung "needs repair" scores 1.00 against "Derelict cottage that needs repair" and,
 * being two terms, sorts ahead of the real subject under the specificity rule.
 */
function isExcludedWord(t: string): boolean {
  if (STOP_WORDS.has(t) || NON_VISUAL_WORDS.has(t)) return true
  if (t.endsWith('s') && t.length > 3) {
    const singular = t.slice(0, -1)
    if (STOP_WORDS.has(singular) || NON_VISUAL_WORDS.has(singular)) return true
  }
  return false
}

function meaningfulTerms(q: string): string[] {
  return q.toLowerCase()
    // Split on hyphens as well as spaces. Keeping them joined produced tokens like
    // "start-up", which matched neither 'start' nor 'up' in the stop lists and so
    // survived to become the search query.
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t))
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Term-overlap score, 0-1, with two guards that plain substring matching lacks.
 *
 * WORD-PREFIX MATCHING, not `includes()`. Bare substring matching scored 'oven' against
 * "A proven method", 'led' against "Newly installed lighting" and 'ice' against
 * "Customer service desk" — and because Openverse's haystack is the whole tag list, a
 * food photo tagged "oven, coating, service" scored 0.667 for "powder coating oven" on
 * pure noise. A leading \b is the right boundary rather than \b…\b: it still matches
 * "sprinklers" for 'sprinkler', which a trailing boundary would reject.
 *
 * ABSOLUTE MINIMUM, not just the ratio — see MIN_TERM_HITS.
 */
function scoreAgainst(haystack: string, terms: string[]): number {
  if (terms.length === 0) return 0
  const hay = haystack.toLowerCase()
  let hits = 0
  for (const t of terms) {
    // Match the term OR its singular form. A leading \b already lets a singular term
    // match plural text ("sprinkler" hits "sprinklers"), but not the reverse — and the
    // keywords are full of plurals. "awnings" failed to match Pexels captions saying
    // "awning", so genuinely relevant photos were scored out and Commons' pictures of
    // Commercial BANK buildings won the slot instead.
    const singular = t.endsWith('s') && t.length > 3 ? t.slice(0, -1) : null
    const pattern = singular
      ? `\\b(?:${escapeRegex(t)}|${escapeRegex(singular)})`
      : `\\b${escapeRegex(t)}`
    if (new RegExp(pattern).test(hay)) hits++
  }
  if (hits < Math.min(MIN_TERM_HITS, terms.length)) return 0
  return hits / terms.length
}

function bigEnough(w: number | null, h: number | null): boolean {
  // Unknown dimensions are allowed through — Openverse occasionally omits them, and
  // rejecting on absent metadata would discard usable photos.
  if (w == null || h == null) return true
  return w >= MIN_WIDTH && h >= MIN_HEIGHT
}

interface FetchResult { json: unknown | null; status: number }

async function getJson(url: string): Promise<FetchResult> {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: ctrl.signal,
      cache: 'no-store',
    })
    // Every source is rate-limited. Any failure yields no candidates and must never
    // delay or break image generation. The status is returned so the caller can tell a
    // throttle apart from a genuine miss.
    if (!res.ok) {
      console.warn(`[stockImages] ${new URL(url).hostname} returned ${res.status}`)
      return { json: null, status: res.status }
    }
    try {
      return { json: await res.json(), status: res.status }
    } catch {
      // A source returning an HTML error page with a 200 would otherwise throw here.
      console.warn(`[stockImages] ${new URL(url).hostname} returned unparseable JSON`)
      return { json: null, status: res.status }
    }
  } catch (e) {
    console.warn(`[stockImages] request failed:`, e instanceof Error ? e.message : e)
    return { json: null, status: 0 }
  } finally {
    clearTimeout(timer)
  }
}

// ── Openverse ────────────────────────────────────────────────────────────────

interface OpenverseResult {
  id?: string; title?: string; url?: string; thumbnail?: string
  creator?: string | null; license?: string; license_url?: string | null
  foreign_landing_url?: string | null; provider?: string | null
  width?: number | null; height?: number | null; attribution?: string | null
  tags?: { name?: string }[]
}

async function searchOpenverse(
  q: string, terms: string[], floor: number,
): Promise<{ results: StockImageCandidate[]; rateLimited: boolean }> {
  const params = new URLSearchParams({
    q,
    // BOTH filters, not just 'commercial'. Commercial alone still returns NoDerivatives
    // (by-nd) results — verified: "What the grass sees...", "Retractable Patio Cover"
    // and "TVR Tuscan detail" all came back under it. A featured image gets cropped and
    // resized, which is exactly what ND forbids, so those are unusable here even though
    // the commercial box is ticked.
    license_type: 'commercial,modification',
    filter_dead:  'true',
    mature:       'false',
    page_size:    '30',
  })
  const { json, status } = await getJson(`${OPENVERSE_ENDPOINT}?${params}`)
  if (status === 429) return { results: [], rateLimited: true }

  const results = (json as { results?: OpenverseResult[] } | null)?.results
  if (!results) return { results: [], rateLimited: false }

  const out: StockImageCandidate[] = []
  for (const r of results) {
    if (!r.id || !r.url || !r.thumbnail) continue
    if (!bigEnough(r.width ?? null, r.height ?? null)) continue
    const relevance = terms.length === 1
      // One-term rungs score against the TITLE only. Openverse concatenates the whole
      // tag list into the haystack, so a single incidental tag was enough for a perfect
      // score and the broad rung drowned the specific ones.
      ? scoreAgainst(r.title ?? '', terms)
      : scoreAgainst(`${r.title ?? ''} ${(r.tags ?? []).map(t => t.name ?? '').join(' ')}`, terms)
    if (relevance < (terms.length === 1 ? SINGLE_TERM_FLOOR : floor)) continue
    out.push({
      id: `ov:${r.id}`,
      source: 'openverse',
      title: r.title ?? '(untitled)',
      url: r.url,
      thumbnail: r.thumbnail,
      creator: r.creator ?? null,
      license: r.license ?? 'unknown',
      licenseUrl: r.license_url ?? null,
      sourceUrl: r.foreign_landing_url ?? null,
      provider: r.provider ?? null,
      width: r.width ?? null,
      height: r.height ?? null,
      attribution: r.attribution ?? null,
      relevance,
      matchedQuery: q,
    })
  }
  return { results: out, rateLimited: false }
}

// ── Pexels ───────────────────────────────────────────────────────────────────

interface PexelsPhoto {
  id?: number; url?: string; alt?: string | null
  photographer?: string | null; photographer_url?: string | null
  width?: number; height?: number
  src?: { large2x?: string; large?: string; original?: string; medium?: string }
}

/**
 * Modern commercial stock. Needs a free API key (PEXELS_API_KEY); absent, this source is
 * skipped and the two keyless sources still run.
 *
 * Ranked above the others when relevance ties, because the quality gap is not marginal.
 * The Pexels licence also allows commercial use with modification and requires no
 * attribution, so there is nothing that must be rendered alongside the image.
 */
async function searchPexels(
  q: string, terms: string[], floor: number,
): Promise<{ results: StockImageCandidate[]; rateLimited: boolean }> {
  const key = process.env.PEXELS_API_KEY
  if (!key) return { results: [], rateLimited: false }

  const params = new URLSearchParams({
    query: q,
    per_page: '40',
    // Featured images render 16:9, so portrait results are wasted slots.
    orientation: 'landscape',
  })

  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  let json: { photos?: PexelsPhoto[] } | null = null
  try {
    const res = await fetch(`https://api.pexels.com/v1/search?${params}`, {
      headers: { Authorization: key, 'User-Agent': USER_AGENT },
      signal: ctrl.signal,
      cache: 'no-store',
    })
    if (res.status === 429) {
      console.warn('[stockImages] Pexels rate limit reached (200/hour) — skipping remaining rungs')
      return { results: [], rateLimited: true }
    }
    if (!res.ok) {
      console.warn(`[stockImages] Pexels returned ${res.status} for "${q}"`)
      return { results: [], rateLimited: false }
    }
    json = await res.json()
  } catch (e) {
    console.warn('[stockImages] Pexels request failed:', e instanceof Error ? e.message : e)
    return { results: [], rateLimited: false }
  } finally {
    clearTimeout(timer)
  }

  const out: StockImageCandidate[] = []
  for (const p of json?.photos ?? []) {
    const full = p.src?.large2x ?? p.src?.original ?? p.src?.large
    if (!p.id || !full) continue
    if (!bigEnough(p.width ?? null, p.height ?? null)) continue

    // Pexels supplies a written description rather than tags, and it is unusually good
    // ("Technician applying powder coating to metal pipes in a workshop"), which makes
    // it a far better scoring target than a filename.
    const relevance = scoreAgainst(p.alt ?? '', terms)
    if (relevance < (terms.length === 1 ? SINGLE_TERM_FLOOR : floor)) continue

    out.push({
      id: `px:${p.id}`,
      source: 'pexels',
      title: p.alt?.trim() || 'Pexels photo',
      url: full,
      thumbnail: p.src?.medium ?? p.src?.large ?? full,
      creator: p.photographer ?? null,
      license: 'Pexels',
      licenseUrl: 'https://www.pexels.com/license/',
      sourceUrl: p.url ?? null,
      provider: 'pexels',
      width: p.width ?? null,
      height: p.height ?? null,
      attribution: p.photographer ? `Photo by ${p.photographer} on Pexels` : 'Photo from Pexels',
      relevance,
      matchedQuery: q,
    })
  }
  return { results: out, rateLimited: false }
}

// ── Wikimedia Commons ────────────────────────────────────────────────────────

/**
 * Licences unambiguously safe to publish on a client's commercial site.
 *
 * Commons mixes far more than CC. The probe surfaced GFDL and "Copyrighted free use"
 * alongside the clean ones — GFDL obliges you to reproduce the entire licence text,
 * which nobody does on a blog post. Anything not matched here is dropped: an unusable
 * photo is worse than no photo, because it looks usable.
 */
function commonsLicenceOk(raw: string): boolean {
  const l = raw.toLowerCase()
  if (/\bnc\b|noncommercial|non-commercial|\bnd\b|noderiv/.test(l)) return false
  if (/fair use|fairuse|copyrighted|gfdl|non-free/.test(l))         return false
  return /public domain|^pd|\bcc0\b|cc by/.test(l)
}

interface CommonsPage {
  title?: string
  imageinfo?: {
    url?: string; thumburl?: string; descriptionurl?: string
    width?: number; height?: number
    extmetadata?: Record<string, { value?: string }>
  }[]
}

async function searchCommons(q: string, terms: string[], floor: number): Promise<StockImageCandidate[]> {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: q,
    gsrnamespace: '6',            // File: namespace
    gsrlimit: '30',
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '400',
    format: 'json',
  })
  const { json } = await getJson(`${COMMONS_ENDPOINT}?${params}`)
  const pages = (json as { query?: { pages?: Record<string, CommonsPage> } } | null)?.query?.pages
  if (!pages) return []

  const out: StockImageCandidate[] = []
  for (const page of Object.values(pages)) {
    const ii = page.imageinfo?.[0]
    if (!ii?.url) continue

    // Commons holds SVG diagrams, PDFs, audio and video in the same namespace. Match the
    // extension allowing for the tracking query-string Commons appends — anchoring on
    // end-of-string alone silently rejected every single result.
    if (!/\.(jpe?g|png|webp)(\?|$)/i.test(ii.url)) continue
    if (!bigEnough(ii.width ?? null, ii.height ?? null)) continue

    const md      = ii.extmetadata ?? {}
    const licence = md.LicenseShortName?.value ?? md.License?.value ?? ''
    if (!commonsLicenceOk(licence)) continue

    const title = (page.title ?? '').replace(/^File:/, '').replace(/\.(jpe?g|png|webp)$/i, '')
    // Commons search matches the whole description page, so score against the title and
    // categories rather than trusting the search rank.
    // Same rule as Openverse: Commons categories are a long incidental list.
    const relevance = terms.length === 1
      ? scoreAgainst(title, terms)
      : scoreAgainst(`${title} ${md.Categories?.value ?? ''}`, terms)
    if (relevance < (terms.length === 1 ? SINGLE_TERM_FLOOR : floor)) continue

    const creator = (md.Artist?.value ?? '').replace(/<[^>]*>/g, '').trim() || null

    out.push({
      id: `wc:${title}`,
      source: 'wikimedia',
      title,
      url: ii.url,
      thumbnail: ii.thumburl ?? ii.url,
      creator,
      license: licence || 'unknown',
      licenseUrl: md.LicenseUrl?.value ?? null,
      sourceUrl: ii.descriptionurl ?? null,
      provider: 'wikimedia',
      width: ii.width ?? null,
      height: ii.height ?? null,
      attribution: creator ? `${title} by ${creator} (${licence})` : `${title} (${licence})`,
      relevance,
      matchedQuery: q,
    })
  }
  return out
}

// ── Orchestration ────────────────────────────────────────────────────────────

/**
 * Build the query ladder: specific first, then progressively shorter.
 *
 * Shortening is what rescues narrow topics — Commons found 1 photo for "powder coating
 * oven" and 10 for "powder coating". Every rung is still derived from THIS post's topic,
 * never the client's industry, so a broader rung stays on-subject.
 */
function buildQueryLadder(ctx: {
  targetKeyword?: string | null
  imageConcept?:  string | null
  title?:         string | null
  /** The client's own service area, stripped from queries — see below. */
  geographicFocus?: string | null
  /** The client's service list, used to anchor the query on the real subject. */
  services?: string | null
}): string[] {
  // Place names are worse than useless in a stock library: no corpus indexes "Brevard
  // County", so the term either matches nothing or, worse, matches something unrelated
  // that happens to share a word. The client's configured service area is the reliable
  // way to know which tokens are geography without trying to guess from capitalisation.
  const serviceTokens = new Set(meaningfulTerms(ctx.services ?? ''))
  const geoTokens = new Set(
    (ctx.geographicFocus ?? '')
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter(t => t.length > 2)
      // A token that also appears in the SERVICES is a subject word, not a place. The
      // field is free text and clients do not respect its name: 5 Star Tuning's reads
      // "dyno tuning and in-shop service…", which deleted 'dyno' and 'tuning' from every
      // query and reduced "custom dyno tuning benefits" to the single word "custom".
      .filter(t => !serviceTokens.has(t)),
  )

  /** Reduce a phrase to the concrete, photographable nouns inside it. */
  function visualTerms(phrase: string): string[] {
    return meaningfulTerms(phrase).filter(t => !isExcludedWord(t) && !geoTokens.has(t))
  }

  const seeds = [ctx.imageConcept, ctx.targetKeyword, ctx.title]
    .map(s => s?.trim())
    .filter((s): s is string => !!s && s.length > 2)

  const ladder: string[] = []
  const push = (q: string) => {
    const norm = q.trim().toLowerCase()
    if (norm.length > 2 && !ladder.some(x => x.toLowerCase() === norm)) ladder.push(q.trim())
  }

  // SHORT QUERIES ONLY. The full phrase is deliberately never sent: these keywords are
  // questions ("how to tell if irrigation system is leaking"), and every library ORs the
  // terms, so a long query returns whatever matches its most generic word. Condensing to
  // two concrete nouns and then one is what actually produces a usable set — Commons
  // returned 1 photo for "powder coating oven" and 10 for "powder coating".
  // ANCHOR ON THE CLIENT'S OWN SERVICES.
  //
  // Position alone cannot pick the subject, and both ends were tried against real
  // keywords. First-N gives the modifier or the verb — "how to tell if irrigation system
  // is leaking" searched "tell" and returned tarot cards. Last-N gives the tail —
  // "signs irrigation system needs repair" searched "repair" and returned smartphone
  // repair, dropping the one word that mattered.
  //
  // What reliably identifies the subject is the client's configured service list:
  // "irrigation", "awnings", "powder coating". A term appearing in BOTH the topic and
  // the services is the thing being written about, so it anchors the query and the
  // nearest other concrete term qualifies it — "irrigation repair", "irrigation
  // leaking", "commercial awnings".
  //
  // This is NOT the industry fallback that was removed earlier. That searched the
  // industry ALONE, unrelated to the post, and filled a powder-coating article with
  // photos of metalwork students. Here the anchor must occur in the post's own topic,
  // and it is always paired with a term from that topic.
  const domainSet = new Set(meaningfulTerms(ctx.services ?? ''))
  /** Service-list membership, tolerant of singular/plural. The topic says "brush guard"
   *  while the services say "Brush guards", so exact matching missed the head noun and
   *  the qualifier fell to "polycarbonate" instead. */
  const domainTerms = {
    has(t: string): boolean {
      if (domainSet.has(t)) return true
      if (t.endsWith('s') && t.length > 3 && domainSet.has(t.slice(0, -1))) return true
      return domainSet.has(`${t}s`)
    },
  }

  for (const seed of seeds) {
    const terms = visualTerms(seed)
    if (terms.length === 0) continue

    const anchors = terms.filter(t => domainTerms.has(t))
    if (anchors.length > 0) {
      // LAST matching service term, not the first. With "commercial awnings" both words
      // are services, and taking the first made the broad fallback rung "commercial" —
      // which returned photographs of Commercial Bank buildings. The later word is the
      // head noun and the specific one, so the fallback becomes "awnings".
      const anchor = anchors[anchors.length - 1]
      const anchorAt = terms.lastIndexOf(anchor)
      // Nearest by distance, preferring another service term at equal distance. The
      // leftmost non-anchor term is often an unrelated verb or modifier from the far end
      // of a question-shaped keyword.
      const qualifier = terms
        .filter(t => t !== anchor)
        .sort((a, b) => {
          const da = Math.abs(terms.indexOf(a) - anchorAt)
          const db = Math.abs(terms.indexOf(b) - anchorAt)
          if (da !== db) return da - db
          return (domainTerms.has(b) ? 1 : 0) - (domainTerms.has(a) ? 1 : 0)
        })[0]
      // Keep the topic's own word order so the phrase reads naturally to the search
      // engines, which do weight adjacency.
      if (qualifier) {
        const pair = terms.filter(t => t === anchor || t === qualifier)
        push(pair.join(' '))
      }
      push(anchor)
      continue
    }

    // No service match — fall back to the tail, which is the head noun more often than
    // the head is at the front.
    if (terms.length >= 2) push(terms.slice(-2).join(' '))
    push(terms[terms.length - 1])
  }

  // Nothing survived the filters — the topic is pure abstraction ("cost comparison
  // guide"). Fall back to the raw meaningful words so the reviewer gets something rather
  // than an empty picker.
  if (ladder.length === 0) {
    for (const seed of seeds) {
      const terms = meaningfulTerms(seed)
      if (terms.length >= 2) push(terms.slice(0, 2).join(' '))
      else if (terms.length === 1) push(terms[0])
    }
  }

  return ladder
}

/**
 * Collapse near-duplicates.
 *
 * Providers hold whole photo sets under one title — "Visit to Atlantic Canvas and
 * Awning" returned four consecutive frames — so without this a single set consumes every
 * slot and the reviewer sees one picture eight times instead of a choice.
 *
 * Grouped on the first four MEANINGFUL title words. Using raw words collapsed three
 * distinct Commons photos onto "mowing the lawn geographorguk", where the distinguishing
 * id was the fifth token, and collided unrelated Pexels photos whose alt sentences share
 * an opening like "Close-up of vibrant coloured…". Titles too short to yield two
 * meaningful words fall back to the id, which never collides.
 *
 * Openverse also INDEXES Commons, so the same photograph can arrive twice under slightly
 * different titles; normalising the "File:" prefix and extension catches that.
 */
function dedupe(list: StockImageCandidate[], limit: number): StockImageCandidate[] {
  // Relevance first, then source quality. The tiebreak matters: at equal relevance a
  // Pexels photo is professionally shot while an Openverse hit is often a 1024px Flickr
  // snapshot, so ordering by relevance alone buried the better picture.
  const SOURCE_RANK: Record<StockSource, number> = { pexels: 0, wikimedia: 1, openverse: 2 }

  // Specificity of the query that FOUND each candidate, ranked before relevance.
  //
  // A one-word query scores a perfect 1.00 against anything containing that word, so
  // without this the broad fallback rung floods the pool and outranks the precise
  // matches it was only meant to backfill. Measured: "repair" returned smartphone and
  // engine repair above "irrigation repair"; "commercial" returned Commercial Bank above
  // "commercial awnings"; "oven" returned croissants above "powder coating oven". Two
  // matched terms is simply more evidence than one, so more terms sorts first.
  const specificity = (c: StockImageCandidate) => c.matchedQuery.trim().split(/\s+/).length

  const seen = new Set<string>()
  const out: StockImageCandidate[] = []
  for (const c of [...list].sort((a, b) =>
    (specificity(b) - specificity(a)) ||
    (b.relevance - a.relevance) ||
    (SOURCE_RANK[a.source] - SOURCE_RANK[b.source]))) {
    const words = meaningfulTerms(c.title.replace(/^file:/i, '').replace(/\.(jpe?g|png|webp)$/i, ''))
    const group = words.length >= 2 ? words.slice(0, 4).join(' ') : c.id
    if (seen.has(group)) continue
    seen.add(group)
    out.push(c)
    if (out.length >= limit) break
  }
  return out
}

/**
 * Find stock candidates for a post, using the same context the AI image prompt is built
 * from so both paths aim at the same picture.
 */
export async function findStockImageCandidates(
  ctx: {
    targetKeyword?: string | null
    imageConcept?:  string | null
    title?:         string | null
    /** The client's service area. Its tokens are stripped from queries — no stock
     *  library indexes "Brevard County", so they match nothing or match wrongly.
     *  REQUIRED (may be null) so a call site cannot silently omit it. */
    geographicFocus: string | null
    /** The client's service list — anchors the query on the post's actual subject.
     *  REQUIRED (may be null): when this was optional, all three call sites omitted it,
     *  nothing type-errored, and the entire anchor branch was unreachable in production
     *  while the tests — which passed it directly — showed it working. */
    services:       string | null
    /** Accepted for call-site compatibility and deliberately unused — see the header. */
    industry?:      string | null
  },
  opts?: {
    /**
     * Override the relevance floor. Automatic searches keep the strict default, because
     * an unattended result becomes a suggestion the reviewer has to disbelieve. A MANUAL
     * search is different — the person typed the query and is looking at thumbnails, so
     * they are the filter and a stricter floor just hides what they asked for.
     */
    minRelevance?: number
    /** Cap on candidates banked. */
    limit?: number
    /** Cap on ladder rungs, i.e. on upstream calls. See MAX_RUNGS. */
    maxRungs?: number
  },
): Promise<StockImageCandidate[]> {
  const floor  = opts?.minRelevance ?? RELEVANCE_FLOOR
  const limit  = opts?.limit ?? MAX_CANDIDATES
  const rungCap = opts?.maxRungs ?? MAX_RUNGS
  const ladder = buildQueryLadder(ctx).slice(0, rungCap)
  if (ladder.length === 0) return []

  const byId = new Map<string, StockImageCandidate>()
  // Once a source has throttled, every further rung against it is a guaranteed 429 that
  // costs latency and burns quota for nothing. Openverse's anonymous allowance in
  // particular is small (about 5 requests/hour burst), so a single ladder can exhaust it.
  let pexelsBlocked    = false
  let openverseBlocked = false

  for (const q of ladder) {
    const terms = meaningfulTerms(q)
    if (terms.length === 0) continue

    // Sources run in parallel — they are independent, so a rung costs one round trip
    // rather than three.
    const [px, ov, wc] = await Promise.all([
      pexelsBlocked    ? Promise.resolve({ results: [], rateLimited: false }) : searchPexels(q, terms, floor),
      openverseBlocked ? Promise.resolve({ results: [], rateLimited: false }) : searchOpenverse(q, terms, floor),
      searchCommons(q, terms, floor),
    ])
    if (px.rateLimited) pexelsBlocked    = true
    if (ov.rateLimited) openverseBlocked = true

    for (const c of [...px.results, ...ov.results, ...wc]) {
      const existing = byId.get(c.id)
      if (!existing || existing.relevance < c.relevance) byId.set(c.id, c)
    }

    // Break on the DEDUPLICATED count, not on byId.size. Counting raw entries let a
    // single photo set fill the quota, stop the ladder, and then collapse to two or
    // three tiles — skipping the broader rungs that exist to rescue exactly that case.
    if (dedupe(Array.from(byId.values()), limit).length >= limit) break
  }

  return dedupe(Array.from(byId.values()), limit)
}

/**
 * Search for a post's stock candidates and store them on the row.
 *
 * Deliberately independent of AI image generation. The obvious home for this was inside
 * generatePostImage, but that is gated on content_settings.content_image_generation — so
 * the clients who have AI images switched OFF, precisely the ones who want a non-AI
 * option, would never have been offered any.
 *
 * Never throws: a stock search failing must not take down whatever called it.
 */
export async function searchAndStoreStockCandidates(
  db: SupabaseClient,
  postId: string,
  ctx: {
    targetKeyword?: string | null
    imageConcept?:  string | null
    title?:         string | null
    /** REQUIRED (may be null) — see findStockImageCandidates. */
    geographicFocus: string | null
    services:       string | null
  },
): Promise<StockImageCandidate[]> {
  try {
    const candidates = await findStockImageCandidates(ctx)

    // An empty result NEVER overwrites a non-empty pool. This function is called both at
    // generation time (nothing to lose) and from the reviewer's "Get new images" (plenty
    // to lose), and an empty list is not always a real answer — every source throttling
    // inside the same 6s window produces one too. Writing [] over a good pool would
    // destroy usable images because a third party was briefly busy. Writing [] over
    // null/absent IS meaningful, since it records "searched, found nothing" rather than
    // "never searched", so that case still persists.
    if (candidates.length === 0) {
      const { data: existing } = await db
        .from('content_posts').select('image_candidates').eq('id', postId).maybeSingle()
      const current = (existing as { image_candidates?: unknown } | null)?.image_candidates
      if (Array.isArray(current) && current.length > 0) {
        console.log(`[stockImages] no new matches for post ${postId} — keeping the ${current.length} already banked`)
        return current as StockImageCandidate[]
      }
    }

    const { error } = await db.from('content_posts')
      .update({ image_candidates: candidates })
      .eq('id', postId)
    if (error) {
      // Deploy-order tolerant: image_candidates only exists from migration 210.
      console.warn(`[stockImages] could not store candidates for ${postId} (apply migration 210): ${error.message}`)
    } else if (candidates.length === 0) {
      console.log(`[stockImages] nothing cleared the relevance floor for post ${postId}`)
    }
    return candidates
  } catch (e) {
    console.warn('[stockImages] candidate search failed:', e instanceof Error ? e.message : e)
    return []
  }
}
