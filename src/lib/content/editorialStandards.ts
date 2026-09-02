// ─────────────────────────────────────────────────────────────────────────────
// Editorial standards — the layer above WRITER_QUALITY_RULES.
//
// WRITER_QUALITY_RULES (blogStrategy.ts) already handles sentence-level craft:
// banned AI-tell phrases, em dashes, heading hierarchy, no padding. This file
// adds the two things that rulebook does not cover:
//
//   1. REGULATED CLAIMS. In finance, medical, legal and insurance verticals the
//      failure mode is not clumsy prose, it is a confidently invented number.
//      An APR, an approval requirement or a monthly payment that the model made
//      up is a compliance problem, not a style problem.
//
//   2. PURPOSE. Google's August 2026 spam update was reported to target content
//      by what it was created FOR, not what it was created WITH. The operative
//      quote from practitioners: "It's not about whether it was created with
//      generative AI, but what it was created for." Sites that survived had
//      human review before publishing; sites that were "automatically posting"
//      end to end "are being filtered and dropped across the board."
//
// So the prompt asks for the thing a ranking-first article never has: analysis
// the reader could not get elsewhere, and an honest admission when we do not
// know something.
// ─────────────────────────────────────────────────────────────────────────────

/** Verticals where an invented number is a compliance issue, not a typo. */
export const REGULATED_VERTICALS = ['finance', 'medical', 'legal', 'insurance'] as const
export type RegulatedVertical = typeof REGULATED_VERTICALS[number]

export function isRegulatedVertical(v: unknown): v is RegulatedVertical {
  return typeof v === 'string' && (REGULATED_VERTICALS as readonly string[]).includes(v)
}

/**
 * Claims that must never be fabricated, per vertical.
 *
 * Written as concrete nouns rather than abstractions ("interest rates" not
 * "financial data") because models comply with specific bans far more reliably
 * than with general ones.
 */
const REGULATED_CLAIM_BANS: Record<RegulatedVertical, string> = {
  finance: `
FINANCIAL ACCURACY — NON-NEGOTIABLE. Violating any of these invalidates the post:
- NEVER state a specific interest rate, APR, monthly payment amount, down payment
  figure, loan term, fee, or total cost of financing unless that exact figure was
  supplied to you in the context above. Do not estimate, illustrate, or give a
  "typical" or "as low as" number.
- NEVER state credit score requirements, approval odds, approval percentages,
  minimum income, or lender underwriting criteria. You do not have this information.
- NEVER describe what a specific lender will or will not do.
- NEVER promise, imply, or suggest that any reader will be approved, is likely to
  be approved, or will qualify. No "guaranteed approval", no "everyone qualifies",
  no "you'll be approved regardless of credit". Approval decisions belong to the
  lender and depend on the individual application.
- Describe the PROCESS truthfully instead: what information an application asks
  for, what happens after submitting, what affects a decision in general terms,
  what the customer can do to prepare. That is genuinely useful and it is true.
- When a reader would want a number you do not have, say plainly that terms vary
  by applicant and point them to apply or contact the team, rather than inventing
  a figure to fill the gap.`,

  medical: `
MEDICAL ACCURACY — NON-NEGOTIABLE:
- Never state dosages, treatment protocols, success rates, or diagnostic criteria
  unless supplied in the context above.
- Never present content as a substitute for professional medical advice, and
  never imply a specific outcome for an individual reader.
- Attribute any clinical claim to a named authority in the prose.`,

  legal: `
LEGAL ACCURACY — NON-NEGOTIABLE:
- Never state statutes, deadlines, filing fees, damages figures, or case outcomes
  unless supplied in the context above.
- Never present content as legal advice or predict the outcome of a matter.
- Jurisdiction changes the answer; say so rather than generalising.`,

  insurance: `
INSURANCE ACCURACY — NON-NEGOTIABLE:
- Never state premiums, coverage limits, deductibles, or eligibility rules unless
  supplied in the context above.
- Never promise that a claim will be covered or paid.
- Coverage depends on the policy and the carrier; say so rather than inventing terms.`,
}

/**
 * The purpose test, aimed squarely at the pattern the spam update penalised.
 *
 * Deliberately phrased as a question the model must answer for itself, because
 * "be helpful" is unactionable while "would this survive without Google" forces
 * a concrete comparison.
 */
const PURPOSE_STANDARD = `
PURPOSE — read this before writing a single word:
Write for the reader first and the search engine second. The test this article
must pass is simple: if Google did not exist, would someone who actually has this
problem still find this page worth reading and act on it?

That rules out several things that are otherwise tempting:
- Do not restate what every other page on this topic already says. If a paragraph
  could appear verbatim on a competitor's site, it is not earning its place.
- Do not summarise; ANALYSE. Say which option you would pick and why, where the
  common advice breaks down, what the trade-off actually costs, what most people
  get wrong. A recommendation with a reason beats a balanced list of options.
- Do not pad. Three sentences of substance stretched to five hundred words is the
  single most recognisable mark of machine-written filler. If a section has
  nothing left to say, end it.
- Do not write to a template. Vary how sections open, how long they run, and how
  they are structured, based on what each one actually needs.
- Concrete beats comprehensive. One worked example a reader can follow is worth
  more than six shallow bullet lists.

Include specific examples ONLY where the context above supports them. An invented
example that sounds plausible is worse than no example, because a reader who acts
on it is misled.`

/** Ask for the media brief the client can actually shoot. */
const ORIGINAL_MEDIA_STANDARD = `
ORIGINAL MEDIA — at the very end of the "content" field, append an HTML comment
the reader never sees, listing 2-4 specific original assets that would make this
page materially better than a text-only competitor:

<!-- MEDIA: photo of ... | short video showing ... | diagram comparing ... -->

Be specific and shootable ("close-up of the hub bore showing the centring ring
seated", not "an image of a wheel"). Prefer assets only this business could
produce: real jobs, real inventory, real process, real before/after. Original
photography and first-hand data are among the few genuine differentiators left
between an expert page and a generated one.`

/** Internal linking framed around commercial paths, not link count. */
const INTERNAL_LINKING_STANDARD = `
INTERNAL LINKING — structure the article so links are useful, not decorative:
- Link where a reader would genuinely want to go next: a product or category page
  when you describe a product, the application or financing page when the reader
  is ready to act, a deeper explainer when you touch a subject too big for this post.
- Anchor text describes the destination in the reader's words. Never "click here",
  never a bare URL, never the same anchor twice.
- Place the action-oriented link where the reader's intent peaks, which is usually
  after you have answered their question, not in the opening paragraph.`

export interface EditorialStandardsOptions {
  /** Adds the vertical's non-negotiable claim bans. */
  vertical?: string | null
  /** Ask for an original-media brief. Default true. */
  requestMediaBrief?: boolean
  /** Include internal-linking guidance. Default true. */
  includeLinkingGuidance?: boolean
}

/**
 * Compose the editorial block appended to the system prompt.
 *
 * Returns '' when nothing applies, so callers can concatenate unconditionally.
 */
export function buildEditorialStandards(opts: EditorialStandardsOptions = {}): string {
  const parts: string[] = [PURPOSE_STANDARD.trim()]

  if (isRegulatedVertical(opts.vertical)) {
    parts.push(REGULATED_CLAIM_BANS[opts.vertical].trim())
  }
  if (opts.includeLinkingGuidance !== false) parts.push(INTERNAL_LINKING_STANDARD.trim())
  if (opts.requestMediaBrief !== false)      parts.push(ORIGINAL_MEDIA_STANDARD.trim())

  parts.push(`
FINAL CHECK before returning the JSON — answer honestly and fix what fails:
1. Would this still be useful to a real customer if Google did not exist?
2. Does it contain at least one insight, recommendation, or concrete detail that a
   generic article on this keyword would not have?
3. Is every number, rate, requirement and policy either supplied in the context
   above or absent? (If you are unsure whether a figure is real, remove it.)
4. Have you promised any outcome you cannot guarantee? Remove it.
5. Does any section exist only to add length? Cut it.`.trim())

  return parts.join('\n\n')
}

