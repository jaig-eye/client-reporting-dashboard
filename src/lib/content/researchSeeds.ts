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

/** Services, as research reads them: trimmed, real words only, and capped. */
export function parseServices(services: unknown): string[] {
  return String(services ?? '')
    .split(/[,\n;]+/).map(v => v.trim()).filter(v => v.length > 2).slice(0, 12)
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
  const first = String(prose ?? '').split(/[,\n;]+/)[0] ?? ''
  return first.split(/\s+and\s+|\s*\(|\s+including\s+/i)[0].trim()
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

  // Service Areas is a list now, strongest first, so the first entry is the primary market and
  // needs no guessing. The prose parsing below stays for clients written as a sentence — which is
  // every client until they are next edited.
  const asList = raw.split(',').map(v => v.trim()).filter(Boolean)
  if (asList.length > 1 && asList.every(v => v.split(/\s+/).length <= 4)) {
    return asList.filter(v => !NON_LOCAL.test(v)).slice(0, 4)
  }

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

