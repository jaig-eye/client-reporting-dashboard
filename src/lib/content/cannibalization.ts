// Keeping a new topic from competing with a page the client already ranks for.
//
// Lives in its own file so it can be tested without a live model. generateTopics passes its own
// request function in; a test passes a stub. The code that ships is the code that is exercised.
//
// THE RULE
//
// The prompt already tells the model what the client ranks for and not to compete with it. This is
// what happens when it does anyway — and since nothing is reviewed until a finished POST needs
// approving, "flag it and carry on" would mean a person's first sight of a collision is an article
// already written against it.
//
// Two kinds of collision, handled differently:
//
// - EXACT: the topic targets the very phrase a page already ranks for. That is a second page for
//   the same query, so it is rejected and the model is asked once more for a replacement, told
//   exactly what collided. Whatever still collides after that is demoted (below).
// - CONTAINS: the topic targets a longer phrase that contains a ranking one — "roof repair cost
//   guide" when "roof repair" ranks. That is the supporting article the prompt asks for, so it is
//   demoted straight away with no extra model call. Regenerating these used to cost two more calls
//   per slot and usually ended in the same demotion.
//
// Demoting never stops a post going out: the topic becomes a supporting article with an internal
// link to the page it must not outrank. Dropping was the old behaviour and it could empty the run —
// a client who already ranks for most of what they sell got an error and no post, from a guard
// meant to protect them.

/** What the guard needs to read and write on a topic. Structural, so callers keep their own type. */
export interface DemotableTopic {
  target_keyword?:   string | null
  ranking_strategy?: string | null
  page_to_support?:  string | null
}

/** A page the client already ranks for, and where. */
export interface ProtectedPage {
  position: number
  url:      string | null
}

export interface Collision {
  /** The protected phrase that was matched. */
  prot:  string
  info:  ProtectedPage
  /** True when the topic targets the protected phrase itself rather than a longer variant. */
  exact: boolean
}

/** Compare keywords the way a search engine would: case, spacing and punctuation carry no meaning. */
export function normalizeKeyword(kw: string | null | undefined): string {
  return String(kw ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The strongest protected phrase a keyword collides with, or null.
 *
 * Exact collision first, then the longest protected phrase contained in the keyword — "lawn care"
 * protected, "lawn care in winter" proposed. Whole-phrase match, so "careers" never matches "care".
 *
 * The LONGEST match wins, not the first. Map order is insertion order, which says nothing about
 * specificity, so first-match could tell a "lawn care in winter" article to support "care" and
 * link to that page instead. A directive naming the wrong URL is worse than none: it points the
 * internal link at the weaker page.
 */
export function findCollision(
  targetKeyword: string | null | undefined,
  protectedKeywords: Map<string, ProtectedPage>,
): Collision | null {
  const kw = normalizeKeyword(targetKeyword)
  if (!kw) return null
  const direct = protectedKeywords.get(kw)
  if (direct) return { prot: kw, info: direct, exact: true }
  let best: Collision | null = null
  for (const [prot, info] of Array.from(protectedKeywords.entries())) {
    if (kw === prot) continue
    // A one-word ranking query ("roof", "tint") only collides exactly. Containment on a single word
    // would demote every topic that mentions it to a supporting article for that one page.
    if (!prot.includes(' ')) continue
    if (!new RegExp(`(^|\\s)${escapeRegex(prot)}(\\s|$)`).test(kw)) continue
    if (!best || prot.length > best.prot.length) best = { prot, info, exact: false }
  }
  return best
}

const DEMOTION_MARK = 'SUPPORTING ARTICLE — '
const DIRECTIVE_END = 'as the primary internal link.'
/**
 * How a directive ends when the ranking page's URL is not known (an Ahrefs-only ranking with no
 * Search Console page). Asking for a link there sent the writer after a page it could not name.
 */
const NO_LINK_END = 'Its URL is not known, so add no link for it.'

/**
 * The brief a demoted topic carries into the writer.
 *
 * It is stored at the front of the topic's ranking_strategy, which is what the operator reads on the
 * pipeline card. The protected phrase is always quoted, so readDemotion can recover it.
 */
export function demotionDirective(c: Collision): string {
  const url  = c.info.url
  const at   = url ? ` at ${url}` : ''
  return c.exact
    ? `${DEMOTION_MARK}the client ALREADY RANKS #${c.info.position} for "${c.prot}" (this exact keyword)${at}.`
      + ` Do NOT write another page targeting it. Shift to a genuinely narrower question this page`
      + (url ? ` does not answer, and link to it (${url}) ${DIRECTIVE_END}` : ` does not answer. ${NO_LINK_END}`)
    : `${DEMOTION_MARK}the client already ranks #${c.info.position} for "${c.prot}"${at}.`
      + ` This must not compete with that page: cover a genuinely narrower question`
      + (url ? ` and link to it (${url}) ${DIRECTIVE_END}` : `. ${NO_LINK_END}`)
}

export interface Demotion {
  /** The directive text alone, without whatever strategy the model wrote after it. */
  directive: string
  /** The phrase the client already ranks for. */
  prot:      string
  /** True when the topic targeted that phrase itself. */
  exact:     boolean
}

/**
 * Whether a topic was demoted, and to support what — read back from its ranking_strategy.
 *
 * Topics demoted before the phrase was always quoted said "for this exact keyword" with no phrase;
 * for those the topic's own target keyword is the protected phrase.
 */
export function readDemotion(rankingStrategy: string | null | undefined, targetKeyword?: string | null): Demotion | null {
  const s = String(rankingStrategy ?? '')
  if (!s.startsWith(DEMOTION_MARK)) return null
  // Whichever ending comes first closes the directive; anything after it is the model's own text.
  const ends = [DIRECTIVE_END, NO_LINK_END]
    .map(e => ({ at: s.indexOf(e), len: e.length }))
    .filter(e => e.at >= 0)
    .sort((a, b) => a.at - b.at)
  const directive = ends.length > 0 ? s.slice(0, ends[0].at + ends[0].len) : s
  const quoted = directive.match(/ranks #\d+ for "([^"]+)"/i)
  const exact  = /this exact keyword/i.test(directive)
  const prot   = quoted?.[1] ?? (exact ? normalizeKeyword(targetKeyword) : '')
  return prot ? { directive, prot, exact } : null
}

export interface ResolveResult<T> {
  topics:   T[]
  /** Counts for the caller to log. */
  rejected: number
  replaced: number
  demoted:  string[]
}

/** Extra model round-trips when a topic targets a phrase the client already ranks for. Billed, so: one. */
export const MAX_REGEN_ROUNDS = 1

/**
 * Handle topics that collide with pages the client already ranks for.
 *
 * Exact collisions are rejected and regenerated (up to maxRounds); containing collisions, and any
 * exact collision a retry could not replace, are demoted to supporting articles.
 *
 * Never returns fewer topics than it was given: every input either survives, is swapped for a
 * clean replacement, or is demoted. The count is the contract — the automation downstream expects
 * to hand a person posts, not an empty run.
 *
 * The order is kept too: a replacement takes the place of the topic it replaces, and a demoted
 * topic stays where it was. The silo queue pairs topics with its keywords by position, so moving a
 * demoted topic to the end handed each keyword the other one's article.
 */
export async function resolveCannibalization<T extends DemotableTopic>(args: {
  topics:            T[]
  protectedKeywords: Map<string, ProtectedPage>
  /** Asks the model again. `extra` is appended to the user prompt. */
  requestTopics:     (extra: string) => Promise<{ topics: T[]; error?: string }>
  maxRounds?:        number
  onLog?:            (message: string) => void
}): Promise<ResolveResult<T>> {
  const { topics, protectedKeywords, requestTopics } = args
  const maxRounds = args.maxRounds ?? MAX_REGEN_ROUNDS
  const log = args.onLog ?? (() => {})

  if (protectedKeywords.size === 0 || topics.length === 0) {
    return { topics, rejected: 0, replaced: 0, demoted: [] }
  }

  const collides = (t: T) => findCollision(t.target_keyword, protectedKeywords)
  // A topic already demoted (a regenerate reusing a stored topic) keeps its brief; it is not judged again.
  const isDemoted = (t: T) => readDemotion(t.ranking_strategy, t.target_keyword) !== null
  // Slots in the input's order. Exact collisions are the only ones worth another model call:
  // a containing collision is demoted where it stands, below, with the rest.
  const out = topics.slice()
  let flagged = out.map((_, i) => i).filter(i => !isDemoted(out[i]) && collides(out[i])?.exact === true)
  const rejected = flagged.length
  let replaced = 0

  for (let round = 1; round <= maxRounds && flagged.length > 0; round++) {
    const rejectedList = flagged.map(i => {
      const t = out[i]
      const c = collides(t)!
      return `  - "${t.target_keyword}" collides with "${c.prot}", which this client already ranks #${c.info.position} for`
    }).join('\n')
    const need = flagged.length
    log(`cannibalization: ${flagged.length} topic(s) rejected, regenerating (round ${round}):\n${rejectedList}`)

    const retry = await requestTopics(
      `\nREJECTED — these proposals cannibalize pages this client already ranks for:\n${rejectedList}\n` +
      `Return exactly ${need} REPLACEMENT topic(s) in the same JSON format. Each must target a` +
      ` keyword that is NOT one of the protected phrases above and does NOT contain one as a whole` +
      ` phrase. Do not repeat any keyword you have already proposed. Narrower, more specific` +
      ` questions are the way out: if the client ranks for "lawn care", "how often to dethatch a` +
      ` fescue lawn" is acceptable and "lawn care tips" is not.`,
    )
    // A failed retry is not a failed run: keep what is clean and fall through to demotion, which
    // still produces usable briefs.
    if (retry.error) { log(`regeneration round ${round} failed: ${retry.error}`); break }

    const stillFlagged = new Set(flagged)
    const seen = new Set(out.filter((_, i) => !stillFlagged.has(i)).map(t => normalizeKeyword(t.target_keyword)))
    const fresh: T[] = []
    for (const t of retry.topics) {
      const kw = normalizeKeyword(t.target_keyword)
      // An exact collision again is no replacement. One that only contains a ranking phrase is
      // acceptable — it becomes a supporting article below, like any other.
      if (!kw || seen.has(kw) || collides(t)?.exact) continue
      seen.add(kw)
      fresh.push(t)
    }
    // Retire exactly as many flagged topics as were actually replaced, each replacement taking the
    // slot of the topic it replaces. Taking fresh.length instead would discard more than were
    // replaced whenever the model returned more than asked for — losing a topic silently instead of
    // demoting it below.
    const took = Math.min(fresh.length, need)
    for (let k = 0; k < took; k++) out[flagged[k]] = fresh[k]
    flagged = flagged.slice(took)
    replaced += took
    if (took > 0) log(`cannibalization: round ${round} replaced ${took} topic(s)`)
  }

  // Whatever still collides — containing collisions, exact ones a retry could not replace, and
  // replacements that contain a ranking phrase — is demoted in place.
  const demoted: string[] = []
  for (const t of out) {
    if (isDemoted(t)) continue
    const c = collides(t)
    if (!c) continue
    const directive = demotionDirective(c)
    t.ranking_strategy = t.ranking_strategy ? `${directive} ${t.ranking_strategy}` : directive
    // The directive is what the operator reads on the pipeline card and what the writer is given
    // (read back with readDemotion). page_to_support is the link target the article prompt renders
    // as "Core page to support", and the writer route adds it to the links it may keep.
    if (c.info.url) t.page_to_support = c.info.url
    demoted.push(`"${t.target_keyword}" → supports "${c.prot}"${c.exact ? ' (exact)' : ''}${c.info.url ? '' : ' (no URL known — directive only)'}`)
  }

  return { topics: out, rejected, replaced, demoted }
}
