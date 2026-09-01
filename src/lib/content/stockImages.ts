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
const MAX_CANDIDATES  = 8
/** Below this, an image is a thumbnail, icon or diagram rather than a usable photo. */
const MIN_WIDTH  = 600
const MIN_HEIGHT = 400

const USER_AGENT = 'client-reporting-dashboard/1.0 (+https://dash.golaunchlocal.com)'

/** Words that carry no visual meaning and would inflate the score for free. */
const STOP_WORDS = new Set([
  'the','a','an','of','for','and','to','in','on','with','your','you','how','what','why',
  'is','are','was','were','be','best','guide','tips','need','know','should','can','do',
  'does','vs','versus','when','which','from','that','this','it','its','about','into',
  'complete','ultimate','top','right','choose','choosing','before','after','made','make',
  'requirements','checklist','explained','everything','common','things','ways','steps',
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

function meaningfulTerms(q: string): string[] {
  return q.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
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
    if (new RegExp(`\\b${escapeRegex(t)}`).test(hay)) hits++
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
    page_size:    '12',
  })
  const { json, status } = await getJson(`${OPENVERSE_ENDPOINT}?${params}`)
  if (status === 429) return { results: [], rateLimited: true }

  const results = (json as { results?: OpenverseResult[] } | null)?.results
  if (!results) return { results: [], rateLimited: false }

  const out: StockImageCandidate[] = []
  for (const r of results) {
    if (!r.id || !r.url || !r.thumbnail) continue
    if (!bigEnough(r.width ?? null, r.height ?? null)) continue
    const relevance = scoreAgainst(`${r.title ?? ''} ${(r.tags ?? []).map(t => t.name ?? '').join(' ')}`, terms)
    if (relevance < floor) continue
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
    per_page: '12',
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
    if (relevance < floor) continue

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
    gsrlimit: '12',
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
    const relevance = scoreAgainst(`${title} ${md.Categories?.value ?? ''}`, terms)
    if (relevance < floor) continue

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
}): string[] {
  const seeds = [ctx.imageConcept, ctx.targetKeyword, ctx.title]
    .map(s => s?.trim())
    .filter((s): s is string => !!s && s.length > 2)

  const ladder: string[] = []
  const push = (q: string) => {
    const norm = q.trim().toLowerCase()
    if (norm.length > 2 && !ladder.some(x => x.toLowerCase() === norm)) ladder.push(q.trim())
  }

  for (const seed of seeds) {
    push(seed)
    const terms = meaningfulTerms(seed)
    // Head noun phrase, then the two-word core. Anything shorter is too generic to stay
    // on-subject and starts behaving like the industry fallback that was removed.
    if (terms.length > 3) push(terms.slice(0, 3).join(' '))
    if (terms.length > 2) push(terms.slice(0, 2).join(' '))
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

  const seen = new Set<string>()
  const out: StockImageCandidate[] = []
  for (const c of [...list].sort((a, b) =>
    (b.relevance - a.relevance) || (SOURCE_RANK[a.source] - SOURCE_RANK[b.source]))) {
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
    /** Manual searches want breadth; the automatic strip wants a short, strong set. */
    limit?: number
  },
): Promise<StockImageCandidate[]> {
  const floor  = opts?.minRelevance ?? RELEVANCE_FLOOR
  const limit  = opts?.limit ?? MAX_CANDIDATES
  const ladder = buildQueryLadder(ctx)
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
  },
): Promise<StockImageCandidate[]> {
  try {
    const candidates = await findStockImageCandidates(ctx)
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
