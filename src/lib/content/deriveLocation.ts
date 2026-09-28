// ─────────────────────────────────────────────────────────────────────────────
// Reading a research location out of the geography someone already typed.
//
// WHY THIS EXISTS
//
// Research finds local competitors by running live SERPs of the service seeds in the client's
// market: the organic top 20 plus the local pack, which is the businesses down the road. That path
// is gated on content_settings.research_location, a structured {code, name} a human picks.
//
// In production, nineteen clients have a content programme and NONE of them has picked one. So the
// local path never runs, competitor discovery falls through to the two national sources, and a
// roofer in Brevard County is told their rivals are the biggest roofing sites in America. The
// machinery was right; the field was empty.
//
// Thirteen of those clients already describe their market in geographic_focus, in prose:
//
//   "Brevard County, FL (based in Cocoa, FL)"
//   "Melbourne, FL and Brevard County"
//   "Fort Worth, Dallas, Arlington, and surrounding DFW areas including Bedford, Sagi…"
//   "Los Angeles and Tri-County area, Southern California"
//   "Nationwide"
//   "All of Canada (coast to coast)"
//
// The first four name a place DataForSEO knows. The last two say, correctly, that this business
// has no local market — and must keep getting national results.
//
// WHAT THIS IS NOT
//
// It does not write to research_location. A guess and a decision should not be stored in the same
// field, or nobody can tell afterwards which one they are looking at. This derives at read time,
// the picker shows it as a suggestion, and the moment a human picks something their choice wins
// permanently.
// ─────────────────────────────────────────────────────────────────────────────

import { dfsSearchLocations, type DfsCreds, type ResearchLocation } from '@/lib/connectors/dataforseo'

/**
 * Phrases that describe the absence of a local market.
 *
 * A business that says "nationwide" is telling us its competitors are national, and forcing it
 * into a city would be a worse answer than leaving it alone.
 */
const NON_LOCAL = /^\s*(nation-?wide|national|all of|across|worldwide|global|online only|e-?commerce|united states|usa|canada|uk)\b/i

/**
 * Candidate place names in the order they are worth trying.
 *
 * Geography is written as prose, so the first clause is usually the primary market —
 * "Brevard County, FL (based in Cocoa, FL)" leads with the county, "Melbourne, FL and Brevard
 * County" with the city. Later clauses are tried only if the first resolves to nothing.
 */
export function locationCandidates(geographicFocus: string): string[] {
  const raw = (geographicFocus ?? '').trim()
  if (!raw || NON_LOCAL.test(raw)) return []

  const out: string[] = []
  // Parentheticals go first, before the split: "(Rockledge and Melbourne)" contains a joiner, so
  // splitting first would tear the bracket in half and leave an orphan "(" in the candidate.
  const withoutAsides = raw.replace(/\([^)]*\)/g, ' ')   // "(based in Cocoa, FL)" is an aside
  // Then split on the joiners people actually use, keeping order.
  for (const clause of withoutAsides.split(/\n|;|\bincluding\b|\bsurrounding\b|\band\b|\bserving\b/i)) {
    const cleaned = clause
      .replace(/\b(area|areas|region|county-wide|metro)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[,\-–—]+|[,\-–—]+$/g, '')
      .trim()
    if (!cleaned || NON_LOCAL.test(cleaned)) continue

    // "Brevard County, FL" searches better as "Brevard County" — the list matches on the name
    // before the first comma.
    const head = cleaned.split(',')[0].trim()
    if (head.length >= 3) out.push(head)
    // Keep the fuller form too: "Los Angeles County" should beat "Los Angeles" when both exist.
    if (cleaned !== head && cleaned.length <= 40) out.push(cleaned)
  }
  return Array.from(new Set(out)).slice(0, 4)
}

/**
 * Resolve the client's prose geography to a location DataForSEO can measure.
 *
 * Returns null when the text describes no local market, when nothing matches, or when the
 * locations list is unreachable — every one of which correctly leaves research country-wide.
 *
 * The locations list is a free endpoint and cached for a day, so this costs nothing per client.
 */
export async function deriveResearchLocation(
  geographicFocus: string,
  creds: DfsCreds,
): Promise<{ location: ResearchLocation; from: string } | null> {
  for (const candidate of locationCandidates(geographicFocus)) {
    let hits
    try {
      hits = await dfsSearchLocations(candidate, creds, { limit: 5 })
    } catch {
      return null                    // list unreachable: country-wide, as before
    }
    if (!hits?.length) continue
    // dfsSearchLocations already ranks exact-name, then country, then City before County before
    // State, so the first hit is the most specific sensible reading of what was written.
    const best = hits[0]
    if (!best?.code || !best?.name) continue
    return {
      location: { code: best.code, name: best.name, type: best.type ?? '' },
      from: candidate,
    }
  }
  return null
}
