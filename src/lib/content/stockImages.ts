// ─────────────────────────────────────────────────────────────────────────────
// Openverse stock-photo candidates for a post's featured image.
//
// An alternative to AI generation, not a replacement: the reviewer picks from real
// CC-licensed photographs when one genuinely fits, and falls back to the generated
// image when none does.
//
// WHY OPENVERSE
// ~700M CC-licensed images, a public API that needs NO key, and — the part that
// matters legally — every result carries its license, creator and attribution, so a
// commercial-use filter is enforceable rather than assumed. Unsplash and Pexels both
// need a key and attach attribution/hotlinking terms that would have to be honoured
// per client.
//
// RELEVANCE IS THE WHOLE PROBLEM, AND IT IS HANDLED HERE
// Openverse ORs the query terms across a corpus that is mostly Flickr and Wikimedia
// consumer photography, so a niche B2B query returns confident nonsense — measured:
// "powder coating oven" returns Palak Paneer and baked aubergine as its top hits.
// Ranking by term overlap against title+tags and discarding anything below
// RELEVANCE_FLOOR separates them cleanly: in the same probe, "lawn care landscaping"
// yielded 10 results at a perfect score and "powder coating oven" yielded ZERO, which
// is the correct answer. Returning nothing is always better than returning a plausible
// wrong photo, so this never relaxes the floor to fill slots.
//
// Consequence worth knowing: coverage is uneven by vertical. Consumer and outdoor
// topics (lawn care, detailing, irrigation) get real candidates; specialised
// industrial topics usually get none and the reviewer just uses the AI image.
//
// Filtering by category=photograph was tested and rejected — it collapsed recall
// (0-1 results on most queries) without measurably improving precision, because the
// score already does that job.
// ─────────────────────────────────────────────────────────────────────────────

const OPENVERSE_ENDPOINT = 'https://api.openverse.org/v1/images/'
const REQUEST_TIMEOUT_MS = 6000
/** Fraction of meaningful query terms that must appear in title+tags. */
const RELEVANCE_FLOOR = 0.5
const MAX_CANDIDATES = 6

/** Words that carry no visual meaning and would inflate the score for free. */
const STOP_WORDS = new Set([
  'the','a','an','of','for','and','to','in','on','with','your','you','how','what','why',
  'is','are','was','were','be','best','guide','tips','need','know','should','can','do',
  'does','vs','versus','when','which','from','that','this','it','its','about','into',
  'complete','ultimate','top','right','choose','choosing','before','after','why',
])

export interface StockImageCandidate {
  id:          string
  title:       string
  /** Full-size image URL on the provider's CDN. */
  url:         string
  thumbnail:   string
  creator:     string | null
  license:     string
  licenseUrl:  string | null
  /** Provider landing page — required by several CC licenses for attribution. */
  sourceUrl:   string | null
  provider:    string | null
  width:       number | null
  height:      number | null
  /** Ready-made attribution string from Openverse; use verbatim where required. */
  attribution: string | null
  /** 0-1 term-overlap score against the query. Kept so the UI can order and explain. */
  relevance:   number
  /** Which of the tried queries produced this hit — useful when debugging misses. */
  matchedQuery: string
}

function meaningfulTerms(q: string): string[] {
  return q.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t))
}

interface OpenverseResult {
  id?: string; title?: string; url?: string; thumbnail?: string
  creator?: string | null; license?: string; license_url?: string | null
  foreign_landing_url?: string | null; provider?: string | null
  width?: number | null; height?: number | null
  attribution?: string | null
  tags?: { name?: string }[]
}

function scoreResult(r: OpenverseResult, terms: string[]): number {
  if (terms.length === 0) return 0
  const hay = `${r.title ?? ''} ${(r.tags ?? []).map(t => t.name ?? '').join(' ')}`.toLowerCase()
  let hits = 0
  for (const t of terms) if (hay.includes(t)) hits++
  return hits / terms.length
}

async function queryOpenverse(q: string): Promise<OpenverseResult[]> {
  const params = new URLSearchParams({
    q,
    license_type: 'commercial',   // safe for client publication
    filter_dead:  'true',         // drop links that no longer resolve
    mature:       'false',
    page_size:    '12',
  })

  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${OPENVERSE_ENDPOINT}?${params}`, {
      headers: { 'User-Agent': 'client-reporting-dashboard/1.0 (+https://dash.golaunchlocal.com)' },
      signal: ctrl.signal,
      cache: 'no-store',
    })
    // Anonymous access is rate-limited. A 429 or any other failure must never break
    // post generation — the AI image path is unaffected and remains the default.
    if (!res.ok) {
      console.warn(`[stockImages] Openverse ${res.status} for "${q}"`)
      return []
    }
    const json = await res.json() as { results?: OpenverseResult[] }
    return json.results ?? []
  } catch (e) {
    console.warn(`[stockImages] Openverse request failed for "${q}":`, e instanceof Error ? e.message : e)
    return []
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Find stock candidates for a post, using the SAME context the AI image prompt is
 * built from so both paths are aiming at the same picture.
 *
 * Queries are tried from most specific to least and merged, because the specific one
 * has the best precision when it hits and the broader one is the only thing that
 * returns anything for a narrow topic. Results are de-duplicated by id, and only
 * those clearing RELEVANCE_FLOOR survive.
 */
export async function findStockImageCandidates(ctx: {
  targetKeyword?: string | null
  imageConcept?:  string | null
  title?:         string | null
  industry?:      string | null
}): Promise<StockImageCandidate[]> {
  // Ordered most-specific first. imageConcept is the art direction the topic generator
  // already wrote for this post, so it is the best single description of what the
  // picture should show.
  //
  // ctx.industry is deliberately NOT queried. It was, as a "top up when the specific
  // queries come back thin" fallback, and it actively broke the guarantee this module
  // exists to provide: a post about a powder coating oven filled all six slots with
  // photos scoring 1.00 against the terms of "metal fabrication" — a shrub-filled yard,
  // and five near-identical shots of school metalwork students — none of which has
  // anything to do with the article. Scoring cannot catch that, because those results
  // genuinely do match the query they were fetched for; the query itself was the
  // problem. An industry is not a subject, so the correct number of candidates for a
  // topic with no real coverage is zero.
  const queries = [
    ctx.imageConcept?.trim(),
    ctx.targetKeyword?.trim(),
  ].filter((q): q is string => !!q && q.length > 2)

  if (queries.length === 0) return []

  const byId = new Map<string, StockImageCandidate>()

  for (const q of queries) {
    const terms = meaningfulTerms(q)
    if (terms.length === 0) continue

    const results = await queryOpenverse(q)
    for (const r of results) {
      if (!r.id || !r.url || !r.thumbnail) continue
      const relevance = scoreResult(r, terms)
      if (relevance < RELEVANCE_FLOOR) continue

      const existing = byId.get(r.id)
      if (existing && existing.relevance >= relevance) continue

      byId.set(r.id, {
        id:           r.id,
        title:        r.title ?? '(untitled)',
        url:          r.url,
        thumbnail:    r.thumbnail,
        creator:      r.creator ?? null,
        license:      r.license ?? 'unknown',
        licenseUrl:   r.license_url ?? null,
        sourceUrl:    r.foreign_landing_url ?? null,
        provider:     r.provider ?? null,
        width:        r.width ?? null,
        height:       r.height ?? null,
        attribution:  r.attribution ?? null,
        relevance,
        matchedQuery: q,
      })
    }

    // Stop early once there is a solid set — avoids spending the anonymous rate
    // limit on broader, weaker queries when the specific one already delivered.
    if (byId.size >= MAX_CANDIDATES) break
  }

  // Collapse near-duplicates before trimming. Providers hold whole photo sets under one
  // title — "Metal Fabrication students of Coonabarabran" returned five separate ids of
  // visually interchangeable frames — and without this a single set consumes every
  // slot, so the reviewer is offered six versions of one picture instead of a choice.
  // Keyed on creator + normalised title stem, which is what those sets share.
  const seenGroup = new Set<string>()
  const deduped: StockImageCandidate[] = []
  for (const c of Array.from(byId.values()).sort((a, b) => b.relevance - a.relevance)) {
    const stem = c.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).slice(0, 4).join(' ')
    const group = `${c.creator ?? ''}|${stem}`
    if (seenGroup.has(group)) continue
    seenGroup.add(group)
    deduped.push(c)
    if (deduped.length >= MAX_CANDIDATES) break
  }
  return deduped
}
