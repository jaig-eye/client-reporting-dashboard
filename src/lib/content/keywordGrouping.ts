// ─────────────────────────────────────────────────────────────────────────────
// Grouping near-duplicate keywords so one theme cannot eat the list.
//
// A real run for a Los Angeles lighting installer returned 240 ideas, of which a large share were
// the same thought in slightly different words:
//
//   christmas light installation los angeles
//   christmas lights installation los angeles
//   christmas light installers los angeles
//   christmas light hanging los angeles
//   christmas lighting company los angeles
//
// Sorted by volume they occupy the top of the list and everything else — landscape lighting,
// permanent outdoor lighting, security lighting — falls below the fold. The list looks saturated
// when the research underneath is actually fine.
//
// The fix is presentational, not destructive: variants collapse under one theme showing the
// strongest, with the rest one click away. Nothing is discarded; breadth is simply shown first.
//
// HOW A THEME IS DECIDED
//
// The first two meaningful words, stemmed, after stripping geography and filler. "christmas light
// installation los angeles" and "christmas lights installers" both reduce to christmas+light and
// group. "landscape lighting design" reduces to landscape+light and does not. Crude, and
// deliberately so: a person has to be able to look at a group and agree with it.
// ─────────────────────────────────────────────────────────────────────────────

/** Words that carry no topic: they should never decide which theme a keyword belongs to. */
const FILLER = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'to', 'in', 'of', 'on', 'at', 'by', 'with', 'near', 'me',
  'my', 'your', 'best', 'top', 'cheap', 'affordable', 'cost', 'costs', 'price', 'prices', 'pricing',
  'company', 'companies', 'service', 'services', 'contractor', 'contractors', 'installer',
  'installers', 'installation', 'install', 'quote', 'quotes', 'estimate', 'estimates',
])

/**
 * Reduce a word to something that matches its variants.
 *
 * Plurals and a few common endings only. Not a real stemmer, and it should not become one: the
 * grouping has to stay explainable to whoever is looking at it.
 */
function stem(word: string): string {
  let w = word
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y'
  if (w.length > 4 && w.endsWith('es'))  w = w.slice(0, -2)
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1)
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3)
  return w
}

/**
 * The theme key for a keyword: its first two meaningful stems.
 *
 * `geoWords` are the parts of the client's market — "los angeles", "california" — which appear in
 * most keywords and would otherwise group everything under the city.
 */
function themeKey(keyword: string, geoWords: Iterable<string> = []): string {
  const geo = new Set(Array.from(geoWords).flatMap(g =>
    String(g).toLowerCase().split(/[\s,]+/).map(w => w.trim()).filter(Boolean)))

  const words = String(keyword ?? '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(w => !FILLER.has(w) && !geo.has(w) && w.length > 1)
    .map(stem)

  // Nothing meaningful left — a pure geo or filler phrase. It is its own theme rather than being
  // lumped in with something it does not belong to.
  if (words.length === 0) return String(keyword ?? '').toLowerCase().trim()
  return words.slice(0, 2).join(' ')
}

export interface GroupedKeyword<T> {
  /** The theme these share, for display: the strongest member's wording, not the stem. */
  label:   string
  /** Strongest first. The first is what the collapsed row shows. */
  members: T[]
}

/**
 * Group keywords by theme, strongest member first, themes ordered by their strongest member.
 *
 * `strength` decides both which member leads a theme and how themes rank against each other —
 * pass whatever the caller already sorts by (volume, or a score).
 */
export function groupKeywords<T>(
  items: T[],
  getKeyword: (item: T) => string,
  strength: (item: T) => number,
  geoWords: Iterable<string> = [],
): GroupedKeyword<T>[] {
  const byTheme = new Map<string, T[]>()
  for (const item of items) {
    const key = themeKey(getKeyword(item), geoWords)
    const list = byTheme.get(key)
    if (list) list.push(item)
    else byTheme.set(key, [item])
  }

  const groups: GroupedKeyword<T>[] = []
  for (const members of Array.from(byTheme.values())) {
    members.sort((a: T, b: T) => strength(b) - strength(a))
    groups.push({ label: getKeyword(members[0]), members })
  }
  // A theme is as strong as its strongest keyword.
  groups.sort((a, b) => strength(b.members[0]) - strength(a.members[0]))
  return groups
}
