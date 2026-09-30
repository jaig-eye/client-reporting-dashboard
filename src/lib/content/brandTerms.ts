// Telling a client's own name apart from the words they sell.
//
// WHY THIS EXISTS
//
// Research reads converting Google Ads search terms, and for most clients the highest-converting
// term by a wide margin is their own brand. 5 Star Tuning's pool came back 21 rows of "5 star
// tuning", "5star tuning", "fivestar tuning", "five star tuning" — every one of them scored near
// the top, because the scorer pays up to +80 for a term that converted. So the list of things to
// write about opened with four spellings of the company's own name.
//
// Those are worth nothing as content targets. Someone searching the brand has already chosen the
// brand; the page that should answer them is the home page, which already exists. An article
// aimed at the same phrase competes with it — the cannibalization we go out of our way to avoid
// everywhere else.
//
// WHY THE RULE IS AS NARROW AS IT IS
//
// The obvious rule — drop anything containing the brand name — is unsafe here, and the client
// list says so plainly. Van Nuys Awning, Irrigation Inc, Space Coast Mobile Detailing and Off
// Road Rim Financing are all named after the thing they sell or the place they sell it. "Contains
// the brand" would throw away "off road wheels" for one of them and "mobile detailing" for
// another: their best keywords, not their brand.
//
// So this matches the brand as a WHOLE, not as an ingredient. A term is branded when what the
// searcher typed is essentially the company's name — the two share a long common prefix that
// accounts for most of the name. "off road wheels" shares only "offroad" with "off road rim
// financing", a third of it, and survives. "5 star tuning f150" shares the entire name and does
// not.
//
// The failure mode is deliberately one-sided: an odd brand variant slipping through costs one
// weak topic suggestion, while a wrongly caught keyword costs a client their best one.

/** Number words, so "five star" and "5 star" are one brand rather than two. */
const NUMERALS: Array<[string, string]> = [
  ['one', '1'], ['two', '2'], ['three', '3'], ['four', '4'], ['five', '5'],
  ['six', '6'], ['seven', '7'], ['eight', '8'], ['nine', '9'], ['ten', '10'],
]

/**
 * Strip a phrase to the letters and digits a brand is recognisable by.
 *
 * Spacing carries no meaning in a brand search — "5star tuning", "5 star tuning" and
 * "fivestartuning" are one request — so spacing is removed rather than tokenised.
 *
 * The numeral pass runs over the joined string, which will also rewrite the "one" inside "stone".
 * That is harmless: both sides of every comparison go through this same function, so the two
 * agree, and the result is only ever compared, never shown.
 */
function compactBrand(s: string): string {
  let out = String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  for (const [word, digit] of NUMERALS) out = out.split(word).join(digit)
  return out
}

/** How many leading characters two strings share. */
function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i++
  return i
}

/** Shortest brand worth matching on. Below this, a prefix match means nothing. */
const MIN_BRAND = 6
/** Shared prefix needed before two strings are the same name. */
const MIN_PREFIX = 7
/** And it must account for this much of the brand, so an ingredient match is not enough. */
const PREFIX_SHARE = 0.7

/** Legal and filler words that carry no brand. Stripped before judging what the name is made of. */
const CORPORATE = new Set([
  'inc', 'llc', 'ltd', 'co', 'corp', 'corporation', 'company', 'group', 'holdings',
  'enterprises', 'the', 'and', 'of', 'a',
])

/** Plural-tolerant whole-word test, so "awning" finds "awnings" in a services list. */
function mentions(haystack: string, word: string): boolean {
  if (!haystack || word.length < 3) return false
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|es)?\\b`, 'i').test(haystack)
}

/**
 * The brand forms to test against: the client's name, and the distinctive part of their domain.
 *
 * Both, because the two disagree often enough to matter — Space Coast Mobile Detailing sits on
 * spacecoastmobiledetail.com, and a searcher may type either.
 *
 * Returns nothing at all for a client whose name, once the legal suffix is removed, is a single
 * word they also sell. Irrigation Inc is that client: its brand compacts to "irrigationinc", and
 * "irrigation" alone covers 77% of it — enough for the prefix rule below to call "irrigation
 * repair" a brand search and throw away the keyword the business is built on. There is no brand
 * here to recognise separately from the service, so nothing is gated. Passing `services` is what
 * makes that check possible; without it the caller gets the unguarded behaviour.
 */
export function brandForms(
  name: string | null | undefined,
  website?: string | null,
  services?: string | null,
): string[] {
  const words = String(name ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const core  = words.filter(w => !CORPORATE.has(w))
  if (core.length === 0) return []
  // A name made entirely of words the client sells is not a brand we can pick out from the
  // service. "Irrigation Inc" is the live case: "irrigation" alone covers 77% of
  // "irrigationinc", enough for the prefix rule to call "irrigation repair" a brand search and
  // throw away the keyword the business is built on. "Roofing Construction" would be the same
  // trap with two words, so the test is every word, not just a lone one.
  const svc = String(services ?? '')
  if (svc && core.every(w => mentions(svc, w))) return []

  const forms = new Set<string>()
  const fromName = compactBrand(name ?? '')
  if (fromName.length >= MIN_BRAND) forms.add(fromName)

  const host = String(website ?? '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .split('.')[0]
  const fromHost = compactBrand(host)
  if (fromHost.length >= MIN_BRAND) forms.add(fromHost)

  return Array.from(forms)
}

/**
 * Is this search term the client's own name rather than something they sell?
 *
 * Matches the name as a whole: the term and the brand must share a long prefix that covers most
 * of the brand. A term that merely contains a brand word — "off road wheels" against "Off Road
 * Rim Financing" — is not branded, and that is the case this narrowness exists to protect.
 *
 * `distinctive`, when given, must also appear in the term: see brandMatcher.
 */
export function isBrandTerm(term: string, forms: string[], distinctive = ''): boolean {
  const t = compactBrand(term)
  if (t.length < 3) return false
  if (distinctive && !t.includes(distinctive)) return false
  return forms.some(brand => {
    const shared = commonPrefix(t, brand)
    return shared >= MIN_PREFIX && shared >= brand.length * PREFIX_SHARE
  })
}

/**
 * A brand test that knows which of the name's words are the brand.
 *
 * The prefix rule alone reads a name built from a place and a service as a brand, and then gates
 * the market's own searches: "Dallas Roofing Pros" on dallasroofingpros.com made "dallas roofing"
 * and "dallas roofing prices" brand searches, and "Van Nuys Awning" did the same to "van nuys
 * awnings". Those are what the business most wants to be found for.
 *
 * So the words of the name that are services or places are set aside, and what is left — "pros",
 * "5 star" — is the brand. A term is branded only when it carries that part: "dallas roofing pros
 * reviews" is, "dallas roofing cost" is not. A name with nothing left over has no brand to pick out
 * and gates nothing, the same answer brandForms already gave Irrigation Inc.
 */
export function brandMatcher(
  name: string | null | undefined,
  website: string | null | undefined,
  services: string | null | undefined,
  geography: string | null | undefined,
): (term: string) => boolean {
  const forms = brandForms(name, website, services)
  if (forms.length === 0) return () => false
  const svc = String(services ?? ''), geo = String(geography ?? '')
  const core = String(name ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !CORPORATE.has(w))
  const own  = core.filter(w => !mentions(svc, w) && !mentions(geo, w))
  if (own.length === 0) return () => false
  const distinctive = compactBrand(own.join(' '))
  return (term: string) => isBrandTerm(term, forms, distinctive)
}
