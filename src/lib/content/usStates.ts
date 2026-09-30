// US and Canadian region names, and the two-letter codes people actually type.
//
// WHY THIS EXISTS
//
// A service area is written the way anyone writes an address: "Melbourne, FL". Two things went
// wrong with that. The chip input split it on the comma into "Melbourne" and "FL", and the
// location search threw the state away entirely — it matched only on the city name and then broke
// ties by country, then type, then SHORTEST NAME.
//
// So "Springfield" resolved to Springfield, Ohio. Not because anything knew the client was in
// Ohio, but because that name is the shortest of the four. A client in Massachusetts would have
// had every search volume measured a thousand miles away, silently, with the UI reporting
// "Measured in Springfield" and looking correct.
//
// Typing the state did not help either: "Melbourne, FL" matched nothing at all, because the search
// compared the whole typed string against the city name alone. The one thing an operator could do
// to disambiguate was the one thing guaranteed to fail.
//
// These tables are what let both halves understand a state: the chip input keeps "Melbourne, FL"
// together, and the search requires Florida once Florida has been named.

/** Two-letter code → the region name DataForSEO stores. */
export const REGION_BY_CODE: Record<string, string> = {
  al: 'Alabama', ak: 'Alaska', az: 'Arizona', ar: 'Arkansas', ca: 'California', co: 'Colorado',
  ct: 'Connecticut', de: 'Delaware', fl: 'Florida', ga: 'Georgia', hi: 'Hawaii', id: 'Idaho',
  il: 'Illinois', in: 'Indiana', ia: 'Iowa', ks: 'Kansas', ky: 'Kentucky', la: 'Louisiana',
  me: 'Maine', md: 'Maryland', ma: 'Massachusetts', mi: 'Michigan', mn: 'Minnesota',
  ms: 'Mississippi', mo: 'Missouri', mt: 'Montana', ne: 'Nebraska', nv: 'Nevada',
  nh: 'New Hampshire', nj: 'New Jersey', nm: 'New Mexico', ny: 'New York',
  nc: 'North Carolina', nd: 'North Dakota', oh: 'Ohio', ok: 'Oklahoma', or: 'Oregon',
  pa: 'Pennsylvania', ri: 'Rhode Island', sc: 'South Carolina', sd: 'South Dakota',
  tn: 'Tennessee', tx: 'Texas', ut: 'Utah', vt: 'Vermont', va: 'Virginia', wa: 'Washington',
  wv: 'West Virginia', wi: 'Wisconsin', wy: 'Wyoming', dc: 'District of Columbia',
  // Canada, because clients sell there too.
  ab: 'Alberta', bc: 'British Columbia', mb: 'Manitoba', nb: 'New Brunswick',
  nl: 'Newfoundland and Labrador', ns: 'Nova Scotia', on: 'Ontario',
  pe: 'Prince Edward Island', qc: 'Quebec', sk: 'Saskatchewan',
}

/** Full region name (lower-cased) → itself, for matching what someone spelled out. */
const REGION_NAMES = new Set(Object.values(REGION_BY_CODE).map(v => v.toLowerCase()))

/**
 * Is this token a region — "FL", "fl", "Florida"?
 *
 * `in` and `or` are real state codes and also ordinary English words, so a bare two-letter token is
 * only treated as a region when it is the LAST thing in the phrase, which is where a state goes.
 * That is handled by the callers; this answers only "could this be a region".
 */
export function isRegionToken(token: string): boolean {
  const t = token.trim().toLowerCase().replace(/\.$/, '')
  return t.length === 2 ? t in REGION_BY_CODE : REGION_NAMES.has(t)
}

/** "FL" → "Florida"; "Florida" → "Florida"; anything else → null. */
export function expandRegion(token: string): string | null {
  const t = token.trim().toLowerCase().replace(/\.$/, '')
  if (t.length === 2) return REGION_BY_CODE[t] ?? null
  return REGION_NAMES.has(t) ? t.replace(/\b\w/g, c => c.toUpperCase()) : null
}

/**
 * Split a typed place into its city/county part and the region, when one was named.
 *
 *   "Melbourne, FL"      → { head: 'Melbourne', region: 'Florida' }
 *   "Melbourne FL"       → { head: 'Melbourne', region: 'Florida' }
 *   "Brevard County, FL" → { head: 'Brevard County', region: 'Florida' }
 *   "Melbourne"          → { head: 'Melbourne', region: null }
 *   "Florida"            → { head: 'Florida', region: null }   ← a region alone is the place
 */
export function splitPlace(input: string): { head: string; region: string | null } {
  const raw = String(input ?? '').trim()
  if (!raw) return { head: '', region: null }

  const comma = raw.lastIndexOf(',')
  if (comma > 0) {
    const tail = raw.slice(comma + 1).trim()
    const region = expandRegion(tail)
    if (region) return { head: raw.slice(0, comma).trim(), region }
  }

  // No comma: only a trailing token, and only when something precedes it — "Florida" on its own is
  // the place being asked for, not a qualifier on nothing.
  const parts = raw.split(/\s+/)
  if (parts.length >= 2) {
    const region = expandRegion(parts[parts.length - 1])
    if (region) return { head: parts.slice(0, -1).join(' '), region }
  }
  return { head: raw, region: null }
}
