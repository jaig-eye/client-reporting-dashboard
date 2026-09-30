// How a stored list of short phrases is read back.
//
// Services, service areas and seed keywords are stored as one comma-joined string, and the chip
// input writes them that way. Every reader has to split them the same way the chip input did, or
// the list means one thing on screen and another to research and the writer. The splitters this
// replaced each cut on every comma, which turned the "Melbourne, FL" chip into two service areas —
// "Melbourne" and "FL" — and research then measured a Melbourne in whichever state sorted first.
//
// No React and no server imports: the chip input, the prompts and research all read through here.

import { isRegionToken } from './usStates'

/** What trails a place name when it comes from a location list: "Melbourne, Florida, United States". */
const COUNTRY_TOKEN = /^(united states( of america)?|u\.?s\.?a?\.?)$/i

/** "Washington, DC" — DC follows a state name, so the state-after-state rule below must not split it. */
const DISTRICT_TOKEN = /^d\.?c\.?$/i

/**
 * Split a comma/newline/semicolon list into phrases.
 *
 *   "Melbourne, FL, Palm Bay, FL"                 → ["Melbourne, FL", "Palm Bay, FL"]
 *   "Brevard County, Florida (including Cocoa, Palm Bay)"
 *                                                 → ["Brevard County, Florida (including Cocoa, Palm Bay)"]
 *   "Florida, Georgia"                            → ["Florida", "Georgia"]
 *   "Melbourne, Florida, United States"           → ["Melbourne, Florida"]
 *   "gutter guards (mesh, micro-mesh), roofing"   → ["gutter guards (mesh, micro-mesh)", "roofing"]
 *
 * Separators inside brackets are not separators. A state following a place joins that place; a
 * state following a state is its own entry. A trailing country is dropped. Duplicates are removed
 * without regard to case, keeping the first spelling.
 */
export function splitPhrases(text: unknown): string[] {
  const raw = String(text ?? '')
  const parts: string[] = []
  let buf = '', depth = 0
  for (const ch of raw) {
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1)
    if (depth === 0 && (ch === ',' || ch === '\n' || ch === ';')) { parts.push(buf); buf = '' }
    else buf += ch
  }
  parts.push(buf)

  const merged: string[] = []
  // Whether the previous entry already ends in a region, so a second region cannot also join it.
  let lastHasRegion = false
  for (const part of parts.map(v => v.trim()).filter(Boolean)) {
    const prev = merged[merged.length - 1]
    // "FL (based in Cocoa, FL)" is still a state: an aside in brackets does not change what it is.
    const bare = part.replace(/\s*[([].*$/, '').trim()
    if (prev !== undefined && COUNTRY_TOKEN.test(bare)) continue
    if (prev !== undefined && !lastHasRegion && isRegionToken(bare) && (!isRegionToken(prev) || DISTRICT_TOKEN.test(bare))) {
      merged[merged.length - 1] = `${prev}, ${part}`
      lastHasRegion = true
      continue
    }
    merged.push(part)
    lastHasRegion = false
  }

  const seen = new Set<string>()
  return merged.filter(p => {
    const key = p.toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
