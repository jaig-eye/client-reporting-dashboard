// ─────────────────────────────────────────────────────────────────────────────
// Free stock-photo candidates for a post's featured image.
//
// An alternative to AI generation, not a replacement: the reviewer picks a real
// photograph when one genuinely fits, and keeps the generated image when none does.
//
// TWO SOURCES, BECAUSE THEY FAIL IN OPPOSITE PLACES
//   • Openverse  — ~700M images, mostly Flickr/Wikimedia consumer photography. Strong
//                  on consumer and outdoor subjects (lawn care, detailing, awnings).
//   • Wikimedia Commons — reference and documentary photography. Strong on exactly the
//                  industrial and technical subjects Openverse cannot serve.
// Measured on the live APIs: "powder coating" returns Palak Paneer, baked aubergine and
// blondies from Openverse, and ten genuinely on-topic industrial photographs from
// Commons. Querying only one source is why coverage felt so thin.
// Neither needs an API key.
//
// RELEVANCE IS THE WHOLE PROBLEM AND IT IS HANDLED HERE
// Openverse ORs query terms across its corpus, so a niche query returns confident
// nonsense. Ranking by term overlap against title+tags and discarding anything below
// RELEVANCE_FLOOR separates signal from noise cleanly. Returning NOTHING is always
// better than returning a plausible wrong photo, so the floor is never relaxed to fill
// slots — a reviewer offered six irrelevant images stops trusting the feature.
//
// QUERY LADDER
// Long queries are the other half of the recall problem: "powder coating oven" found 1
// photo on Commons, "powder coating" found 10. So queries are tried specific-first and
// progressively shortened, stopping as soon as enough candidates are found. Shortened
// queries are still derived from the POST's own topic, which is what makes them safe —
// an earlier version fell back to the client's *industry*, and a powder-coating article
// filled every slot with photos of school metalwork students that scored perfectly
// against "metal fabrication". An industry is not a subject.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'

const OPENVERSE_ENDPOINT = 'https://api.openverse.org/v1/images/'
const COMMONS_ENDPOINT   = 'https://commons.wikimedia.org/w/api.php'
const REQUEST_TIMEOUT_MS = 6000
/** Fraction of the query's meaningful terms that must appear in title/tags. */
const RELEVANCE_FLOOR = 0.5
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

export interface StockImageCandidate {
  id:          string
  title:       string
  url:         string
  thumbnail:   string
  creator:     string | null
  license:     string
  licenseUrl:  string | null
  sourceUrl:   string | null
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

function scoreAgainst(haystack: string, terms: string[]): number {
  if (terms.length === 0) return 0
  const hay = haystack.toLowerCase()
  let hits = 0
  for (const t of terms) if (hay.includes(t)) hits++
  return hits / terms.length
}

function bigEnough(w: number | null, h: number | null): boolean {
  // Unknown dimensions are allowed through — Openverse occasionally omits them, and
  // rejecting on absent metadata would discard usable photos.
  if (w == null || h == null) return true
  return w >= MIN_WIDTH && h >= MIN_HEIGHT
}

async function getJson(url: string): Promise<unknown | null> {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: ctrl.signal,
      cache: 'no-store',
    })
    // Both APIs are anonymous and rate-limited. Any failure yields no candidates and
    // must never delay or break image generation.
    if (!res.ok) {
      console.warn(`[stockImages] ${new URL(url).hostname} returned ${res.status}`)
      return null
    }
    return await res.json()
  } catch (e) {
    console.warn(`[stockImages] request failed:`, e instanceof Error ? e.message : e)
    return null
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

async function searchOpenverse(q: string, terms: string[]): Promise<StockImageCandidate[]> {
  const params = new URLSearchParams({
    q,
    // BOTH filters, not just 'commercial'. Commercial alone still returns NoDerivatives
    // (by-nd) results — verified: "What the grass sees...", "Retractable Patio Cover"
    // and "TVR Tuscan detail" all came back under it. A featured image gets cropped and
    // resized, which is exactly what ND forbids, so those are unusable here even though
    // the commercial box is ticked. Adding 'modification' restricts to licences that
    // permit both, which is what publishing on a client's site actually requires.
    license_type: 'commercial,modification',
    filter_dead:  'true',
    mature:       'false',
    page_size:    '12',
  })
  const json = await getJson(`${OPENVERSE_ENDPOINT}?${params}`) as { results?: OpenverseResult[] } | null
  if (!json?.results) return []

  const out: StockImageCandidate[] = []
  for (const r of json.results) {
    if (!r.id || !r.url || !r.thumbnail) continue
    if (!bigEnough(r.width ?? null, r.height ?? null)) continue
    const relevance = scoreAgainst(`${r.title ?? ''} ${(r.tags ?? []).map(t => t.name ?? '').join(' ')}`, terms)
    if (relevance < RELEVANCE_FLOOR) continue
    out.push({
      id: `ov:${r.id}`,
      title: r.title ?? '(untitled)',
      url: r.url,
      thumbnail: r.thumbnail,
      creator: r.creator ?? null,
      license: r.license ?? 'unknown',
      licenseUrl: r.license_url ?? null,
      sourceUrl: r.foreign_landing_url ?? null,
      provider: r.provider ?? 'openverse',
      width: r.width ?? null,
      height: r.height ?? null,
      attribution: r.attribution ?? null,
      relevance,
      matchedQuery: q,
    })
  }
  return out
}

// ── Wikimedia Commons ────────────────────────────────────────────────────────

/**
 * Licences that are unambiguously safe to publish on a client's commercial site.
 *
 * Commons mixes far more than CC. The probe surfaced GFDL and "Copyrighted free use"
 * alongside the clean ones — GFDL obliges you to reproduce the entire licence text,
 * which nobody is going to do on a blog post, and the vaguer tags are not worth
 * interpreting on a client's behalf. Anything not matched here is dropped: an
 * unusable photo is worse than no photo, because it looks usable.
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

async function searchCommons(q: string, terms: string[]): Promise<StockImageCandidate[]> {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: q,
    gsrnamespace: '6',            // File: namespace
    gsrlimit: '12',
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '400',            // gives us a thumbnail
    format: 'json',
  })
  const json = await getJson(`${COMMONS_ENDPOINT}?${params}`) as { query?: { pages?: Record<string, CommonsPage> } } | null
  const pages = json?.query?.pages
  if (!pages) return []

  const out: StockImageCandidate[] = []
  for (const page of Object.values(pages)) {
    const ii = page.imageinfo?.[0]
    if (!ii?.url) continue

    // Commons holds SVG diagrams, PDFs, audio and video in the same namespace. Match
    // the extension allowing for the tracking query-string Commons appends — anchoring
    // on end-of-string alone silently rejected every single result.
    if (!/\.(jpe?g|png|webp)(\?|$)/i.test(ii.url)) continue
    if (!bigEnough(ii.width ?? null, ii.height ?? null)) continue

    const md      = ii.extmetadata ?? {}
    const licence = md.LicenseShortName?.value ?? md.License?.value ?? ''
    if (!commonsLicenceOk(licence)) continue

    const title = (page.title ?? '').replace(/^File:/, '').replace(/\.(jpe?g|png|webp)$/i, '')
    // Commons search matches the file's whole description page, so score against the
    // title and the categories rather than trusting the search rank.
    const relevance = scoreAgainst(`${title} ${md.Categories?.value ?? ''}`, terms)
    if (relevance < RELEVANCE_FLOOR) continue

    const artistHtml = md.Artist?.value ?? ''
    const creator    = artistHtml.replace(/<[^>]*>/g, '').trim() || null

    out.push({
      id: `wc:${title}`,
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
 * oven" and 10 for "powder coating". Every rung is still derived from THIS post's
 * topic, never from the client's industry, so a broader rung stays on-subject.
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
    // Head noun phrase, then the two-word core. Anything shorter is too generic to
    // stay on-subject and starts behaving like the industry fallback that was removed.
    if (terms.length > 3) push(terms.slice(0, 3).join(' '))
    if (terms.length > 2) push(terms.slice(0, 2).join(' '))
  }
  return ladder
}

/**
 * Find stock candidates for a post, using the same context the AI image prompt is built
 * from so both paths aim at the same picture.
 */
export async function findStockImageCandidates(ctx: {
  targetKeyword?: string | null
  imageConcept?:  string | null
  title?:         string | null
  /** Accepted for call-site compatibility and deliberately unused — see the header. */
  industry?:      string | null
}): Promise<StockImageCandidate[]> {
  const ladder = buildQueryLadder(ctx)
  if (ladder.length === 0) return []

  const byId = new Map<string, StockImageCandidate>()

  for (const q of ladder) {
    const terms = meaningfulTerms(q)
    if (terms.length === 0) continue

    // Both sources in parallel — they are independent and this halves the wall time.
    const [ov, wc] = await Promise.all([
      searchOpenverse(q, terms),
      searchCommons(q, terms),
    ])

    for (const c of [...ov, ...wc]) {
      const existing = byId.get(c.id)
      if (!existing || existing.relevance < c.relevance) byId.set(c.id, c)
    }

    if (byId.size >= MAX_CANDIDATES) break
  }

  // Collapse near-duplicates before trimming. Providers hold whole photo sets under one
  // title — "Visit to Atlantic Canvas and Awning" returned four consecutive frames, and
  // "Metal Fabrication students of Coonabarabran" five — so without this a single set
  // consumes every slot and the reviewer is shown one picture eight times instead of a
  // choice. Keyed on creator + title stem, which is what those sets share.
  const seenGroup = new Set<string>()
  const deduped: StockImageCandidate[] = []
  for (const c of Array.from(byId.values()).sort((a, b) => b.relevance - a.relevance)) {
    // Openverse INDEXES Wikimedia Commons, so querying both surfaces the same photograph
    // twice under slightly different titles — one carrying Commons' "File:" prefix and
    // extension. Normalise those away before grouping, or the reviewer sees the same
    // picture in two adjacent tiles. Creator is excluded from the key here because the
    // two sources attribute the same image differently.
    const stem = c.title
      .toLowerCase()
      .replace(/^file:/, '')
      .replace(/\.(jpe?g|png|webp)$/i, '')
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/).filter(Boolean).slice(0, 4).join(' ')
    const group = stem
    if (seenGroup.has(group)) continue
    seenGroup.add(group)
    deduped.push(c)
    if (deduped.length >= MAX_CANDIDATES) break
  }
  return deduped
}

/**
 * Search for a post's stock candidates and store them on the row.
 *
 * Deliberately independent of AI image generation. The obvious home for this was inside
 * generatePostImage, but that is gated on content_settings.content_image_generation — so
 * the clients who have AI images switched OFF, precisely the ones who want a non-AI
 * option, would never have been offered any. It is also what makes the on-demand
 * "Find free images" button work for posts that already exist.
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
