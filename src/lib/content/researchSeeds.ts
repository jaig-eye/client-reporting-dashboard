// What keyword research actually searches from.
//
// This used to live inside clientResearch, and the settings form offered a second chip input —
// "Search keyword research from" — that the operator filled in by hand. In practice it was a
// verbatim copy of Services Offered, because that is what it is: research already searches
// outwards from the services, and the extra field only added a way for the two to disagree.
//
// So the form shows the seeds instead of asking for them, and the preview it renders is built by
// this module — the same module research itself calls. A preview computed separately would drift
// from the real thing the first time either changed, and a preview that is wrong is worse than
// none, because it is the only place the operator can see what their money buys.

import { splitPhrases } from './phrases'
import { splitPlace } from './usStates'

/** Services, as research reads them: trimmed, real words only, and capped. */
export function parseServices(services: unknown): string[] {
  // Split the way the chip input stored them, so "gutter guards (mesh, micro-mesh)" stays one service.
  return splitPhrases(services).filter(v => v.length > 2).slice(0, 12)
}

/**
 * The place name pinned onto a service to make the search local.
 *
 * A picked Research Location wins. Failing that it is read out of the first service area, which is
 * prose — "Los Angeles and Tri-County area" is one entry meaning one city — so the joiners are cut
 * and the head is kept.
 */
export function geoPhrase(location: { name: string } | null, prose: string): string {
  const fromLocation = location ? location.name.split(',')[0].replace(/\s+county$/i, '').trim() : ''
  if (fromLocation) return fromLocation
  const first = splitPhrases(prose)[0] ?? ''
  // "Melbourne, FL" pins "Melbourne" on, the same head a picked location gives.
  return splitPlace(first.split(/\s+and\s+|\s*\(|\s+including\s+/i)[0]).head.trim()
}

/**
 * Every phrase research searches outwards from.
 *
 * Each service is searched plainly and again with the market pinned on, because the geo variants
 * matter twice over: they make the SERPs local, so the competitors found are the ones down the
 * road, and they give keyword ideas a local angle to expand from.
 *
 * `foundational` is content_settings.foundational_keywords — no longer editable, but still read,
 * so the phrases existing clients had typed keep working.
 */
export function buildResearchSeeds(services: string[], geo: string, foundational: string[] = []): string[] {
  const fromServices = geo ? services.flatMap(s => [s, `${s} ${geo}`]) : services
  return Array.from(new Set([...foundational, ...fromServices]))
}

/**
 * Phrases that describe the absence of a local market.
 *
 * A business that says "nationwide" is telling us its competitors are national, and forcing it
 * into a city would be a worse answer than leaving it alone.
 */
/** Words that make service-area text a sentence rather than a list of places. */
const PROSE_JOINER = /\n|;|\b(including|surrounding|and|serving)\b/i

const NON_LOCAL =/^\s*(nation-?wide|national|all of|across|worldwide|global|online only|e-?commerce|united states|usa|canada|uk)\b/i

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

  // Service Areas is a list now, strongest first, so the first entry is the primary market and
  // needs no guessing. The prose parsing below stays for clients written as a sentence — which is
  // every client until they are next edited.
  //
  // Split the way the chip input stored it. Cutting on every comma turned the "Springfield, MA"
  // chip into "Springfield" and "MA", and "Springfield" alone resolves to Ohio.
  //
  // Each entry is tried as typed first ("Melbourne, FL" is already a place), then the way prose is
  // read. An entry is still prose someone typed: "Los Angeles and Tri-County area" is one chip
  // meaning one city, and only the prose reading finds Los Angeles in it. Trying entries as typed
  // and nothing else sent such a client's research country-wide, where reading the same words as
  // one sentence had found the city.
  //
  // Only a plain list is read as one. Text with joiners ("Melbourne, FL and Brevard County") is a
  // sentence: splitting it on commas cut the state off its city and looked up a bare "Melbourne".
  const asList = splitPhrases(raw)
  if (asList.length > 1 && !PROSE_JOINER.test(raw) && asList.every(v => v.split(/\s+/).length <= 5)) {
    const out: string[] = []
    for (const entry of asList) {
      if (NON_LOCAL.test(entry)) continue
      out.push(entry, ...proseCandidates(entry))
    }
    return Array.from(new Set(out)).slice(0, 6)
  }

  return Array.from(new Set(proseCandidates(raw))).slice(0, 4)
}

/** Place names read out of prose, in the order written: joiners cut, area words dropped. */
function proseCandidates(raw: string): string[] {
  const out: string[] = []
  // Parentheticals go first, before the split: "(Rockledge and Melbourne)" contains a joiner, so
  // splitting first would tear the bracket in half and leave an orphan "(" in the candidate.
  const withoutAsides = raw.replace(/\([^)]*\)/g, ' ')   // "(based in Cocoa, FL)" is an aside
  // Then split on the joiners people actually use, keeping order.
  for (const clause of withoutAsides.split(/\n|;|\bincluding\b|\bsurrounding\b|\band\b|\bserving\b/i)) {
    const cleaned = clause
      .replace(/\b(area|areas|region|county-wide|metro)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .replace(/ ,/g, ',')
      .trim()
      .replace(/^[,\-–—]+|[,\-–—]+$/g, '')
      .trim()
    if (!cleaned || NON_LOCAL.test(cleaned)) continue

    // A named state goes to the lookup whole: dfsSearchLocations splits "Brevard County, FL" into
    // name and state itself and requires the state to match. Trying the bare head as well would
    // hand back the county or city of that name in whichever state sorts first.
    if (splitPlace(cleaned).region) {
      out.push(cleaned)
      continue
    }
    const head = cleaned.split(',')[0].trim()
    if (head.length >= 3) out.push(head)
    // Keep the fuller form too: "Los Angeles County" should beat "Los Angeles" when both exist.
    if (cleaned !== head && cleaned.length <= 40) out.push(cleaned)
  }
  return out
}

