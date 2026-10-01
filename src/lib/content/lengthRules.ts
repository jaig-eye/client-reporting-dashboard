// How long an article is allowed to be, and when a shortened rewrite replaces the original.
//
// Both writing paths use this — a new article from a topic, and a full regenerate of an existing
// post — so a client's length setting means the same thing whichever button produced the text.
// Before, only the topic path held posts to a range; a regenerated post came back as long as ever.
//
// Pure functions, no I/O: the routes make the AI calls and hand the results in here to be judged.

export interface LengthBudget {
  /** The client's target_length (or the brief's word_count_target). */
  target:  number
  /** 90% of target. */
  floor:   number
  /** 115% of target. Anything above this gets one tighten pass. */
  ceiling: number
}

/** Below this share of target a rewrite has cut substance, not padding, and is refused. */
const HARD_MINIMUM = 0.75

export function lengthBudget(target: unknown, fallback = 1500): LengthBudget {
  const t = Math.max(300, Number(target ?? fallback) || fallback)
  return { target: t, floor: Math.round(t * 0.9), ceiling: Math.round(t * 1.15) }
}

/** The prompt's length requirement, replacing "Target approximately N words". */
export function lengthInstruction(b: LengthBudget): string {
  return (
    `LENGTH — this is a requirement, not a guide.\n` +
    `Write between ${b.floor} and ${b.ceiling} words. ${b.target} is the target.\n` +
    `Going over ${b.ceiling} words is a failure of the brief, however good the writing is. ` +
    `Cover the brief fully within that budget: fewer sections, tighter sentences, no recap of ` +
    `what you already said, no restating the question before answering it.`
  )
}

export function isOverLength(b: LengthBudget, words: number): boolean {
  return words > b.ceiling
}

/** The one revision request an over-length draft gets. `draft` is the model's full response. */
export function tightenPrompt(b: LengthBudget, words: number, draft: string): string {
  return (
    `The article below is ${words} words. The brief allows at most ${b.ceiling}, targeting ${b.target}.\n\n` +
    `Cut it to ${b.target} words. Keep every heading, every fact, the internal links, and the ` +
    `FAQ if there is one. Remove repetition, throat-clearing openings, sentences that restate ` +
    `the heading, and padding like "in today's world". Do not add anything new.\n\n` +
    `Return the same JSON shape you were given.\n\n${draft}`
  )
}

const countLinks    = (html: string) => (html.match(/<a\s[^>]*href=/gi) ?? []).length
const countHeadings = (html: string) => (html.match(/<h[23][\s>]/gi) ?? []).length

export interface Draft { words: number; html: string; title: string }

export interface TightenVerdict {
  accept: boolean
  /** One line for the log: why the rewrite was or was not used. */
  reason: string
}

/**
 * Should the shortened rewrite replace the original?
 *
 * Shorter is not enough. A rewrite that hit the number by deleting internal links or collapsing the
 * outline is a worse article that happens to measure correctly — internal linking is the point of
 * the silo work, so losing it quietly is the most expensive way this could go wrong.
 *
 * It must be shorter AND closer to target. It may land under the floor (a 1,300-word rewrite of a
 * 2,700-word draft against a 1,500 target is a better article than the draft), but not under 75% of
 * target, which means substance was cut rather than padding.
 */
export function judgeTightened(b: LengthBudget, before: Draft, after: Draft): TightenVerdict {
  const linksBefore = countLinks(before.html), linksAfter = countLinks(after.html)
  const headsBefore = countHeadings(before.html), headsAfter = countHeadings(after.html)
  const detail =
    `${before.words} → ${after.words} words (target ${b.target}), ` +
    `links ${linksBefore} → ${linksAfter}, headings ${headsBefore} → ${headsAfter}`

  if (!after.title.trim())                         return { accept: false, reason: `no title — ${detail}` }
  if (after.words >= before.words)                 return { accept: false, reason: `not shorter — ${detail}` }
  if (Math.abs(after.words - b.target) >= Math.abs(before.words - b.target))
                                                   return { accept: false, reason: `not closer to target — ${detail}` }
  if (after.words < Math.round(b.target * HARD_MINIMUM))
                                                   return { accept: false, reason: `cut below ${Math.round(HARD_MINIMUM * 100)}% of target — ${detail}` }
  if (linksAfter < linksBefore)                    return { accept: false, reason: `lost links — ${detail}` }
  // Cutting words costs some headings legitimately; losing a quarter of them means the outline was
  // rewritten rather than tightened.
  if (headsAfter < Math.ceil(headsBefore * 0.75))  return { accept: false, reason: `lost headings — ${detail}` }
  return { accept: true, reason: detail }
}
