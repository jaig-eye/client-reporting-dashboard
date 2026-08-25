// ─────────────────────────────────────────────────────────────────────────────
// Pre-publish quality gate.
//
// The prompt asks for good content; this checks whether it arrived. Two kinds of
// check live here, and the second is the one a generic tool cannot do:
//
//   PER-POST   — did the model actually comply? banned phrases, em dashes,
//                keyword stuffing, invented figures, promise language, padding.
//
//   PER-CORPUS — is this post shaped like every other post on the client's site?
//                Google's August 2026 spam update was reported to hit sites whose
//                pages shared the "same AI slop formatting of subheadings and
//                bullets". That is a signal you can only see by comparing a draft
//                against the site's existing published posts, which we have.
//
// IMPORTANT CALIBRATION: BLOG_STRUCTURE_RULES mandates a Key Takeaways box after
// the intro and an optional FAQ. Every blog post therefore shares that skeleton
// BY DESIGN. Fingerprinting raw HTML would flag the house style as duplication
// and make the check useless, so mandated sections are stripped before comparison.
// What remains is the part the model actually chose, which is what we want to know
// about.
//
// Nothing here blocks a human from publishing. It blocks UNATTENDED publishing and
// tells the reviewer where to look — which matches the reported finding that sites
// doing "manual visual checks by humans before publishing" came through fine.
// ─────────────────────────────────────────────────────────────────────────────

export type FindingSeverity = 'critical' | 'warning' | 'info'

export interface QualityFinding {
  code:     string
  severity: FindingSeverity
  message:  string
  /** Verbatim offending snippets, for the reviewer to jump to. */
  evidence?: string[]
}

export interface QualityReport {
  findings:      QualityFinding[]
  /** 0-100. Presentational only — the findings are the substance. */
  score:         number
  /** True when a finding is severe enough that a human must look before it ships. */
  blocksAutoPush: boolean
  wordCount:     number
}

// ── Text helpers ─────────────────────────────────────────────────────────────

function stripTags(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? []
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)
}

/**
 * Remove sections the house style REQUIRES, so the structural fingerprint
 * measures authored shape rather than compliance with our own template.
 */
export function stripMandatedSections(html: string): string {
  let out = html
  // Key Takeaways heading plus the list that follows it.
  out = out.replace(/<h2[^>]*>\s*key takeaways\s*<\/h2>\s*(<ul[\s\S]*?<\/ul>)?/gi, ' ')
  // FAQ heading and everything after it (FAQ is always terminal in this template).
  out = out.replace(/<h2[^>]*>\s*(frequently asked questions|faqs?)\s*<\/h2>[\s\S]*$/i, ' ')
  return out
}

// ── Per-post checks ──────────────────────────────────────────────────────────

/**
 * Compliance check against the ban list in WRITER_QUALITY_RULES. The prompt
 * forbids these; this verifies the model listened, which it does not always do.
 */
const AI_TELL_PHRASES = [
  "in today's digital landscape", "in today's fast-paced world", 'in the ever-evolving',
  'when it comes to', "it's important to note", "it's worth noting", 'needless to say',
  'dive into', 'delve into', "let's explore", "let's take a look", 'game-changer',
  'navigate the landscape', 'navigating the world of', 'revolutionize', 'seamless',
  'cutting-edge', 'state-of-the-art', 'harness the power of', 'unlock', 'elevate',
  'empower', 'robust', 'streamline', 'top-notch', 'look no further', 'rest assured',
  'at the end of the day', 'a myriad of', 'plethora', 'it goes without saying',
]

/** Filler that signals a thought stretched to fill space. */
const PADDING_PHRASES = [
  'as previously mentioned', 'as we discussed', 'in this section we will',
  'in this article we will', 'this article will explore', 'without further ado',
  'the bottom line is', 'that being said', 'more often than not', 'in order to',
  'it is worth mentioning', 'there are a number of', 'a wide variety of',
  'plays a crucial role', 'plays a vital role', 'is key to understanding',
]

/** Language that promises an outcome nobody can guarantee. */
const PROMISE_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bguaranteed\s+approval\b/i,                       label: 'guaranteed approval' },
  { re: /\bapproval\s+is\s+guaranteed\b/i,                  label: 'approval is guaranteed' },
  { re: /\beveryone\s+(?:qualifies|is\s+approved)\b/i,      label: 'everyone qualifies' },
  { re: /\byou\s+will\s+(?:be\s+approved|qualify)\b/i,      label: 'you will be approved' },
  { re: /\bno\s+credit\s+check\s+(?:required|needed)\b/i,   label: 'no credit check required' },
  { re: /\bregardless\s+of\s+(?:your\s+)?credit\b/i,        label: 'regardless of credit' },
  { re: /\bwe\s+(?:can\s+)?approve\s+(?:you|anyone|everyone)\b/i, label: 'we can approve you' },
  { re: /\b100%\s+approval\b/i,                             label: '100% approval' },
]

/**
 * Figures that read as underwriting facts. Any of these appearing without a named
 * source is exactly the invented-number failure the editorial standards ban.
 */
const FINANCIAL_FIGURE_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b\d{1,2}(?:\.\d+)?\s*%\s*(?:apr|interest|rate)\b/gi,          label: 'a specific rate/APR' },
  { re: /\bapr\s+(?:of|as\s+low\s+as|starting\s+at)\s+\d/gi,            label: 'an APR figure' },
  { re: /\$\s?\d[\d,]*(?:\.\d{2})?\s*(?:\/|\s+per\s+)?\s*(?:mo|month)\b/gi, label: 'a monthly payment amount' },
  { re: /\bcredit\s+score\s+(?:of|above|over|at\s+least|minimum\s+of)\s+\d{3}\b/gi, label: 'a credit score requirement' },
  { re: /\b\d{3}\+?\s+credit\s+score\b/gi,                              label: 'a credit score requirement' },
  { re: /\b(?:approval|acceptance)\s+rate\s+of\s+\d/gi,                 label: 'an approval rate' },
  { re: /\bas\s+low\s+as\s+\$?\d/gi,                                    label: 'an "as low as" figure' },
]

/** Named-source markers that make a figure defensible. */
const SOURCE_MARKERS = /\b(according to|per the|reported by|data from|study by|survey by|source:|states that|published by)\b/i

function findPhrases(text: string, phrases: string[]): string[] {
  const lower = text.toLowerCase()
  return phrases.filter(p => lower.includes(p))
}

function collectMatches(text: string, re: RegExp, cap = 5): string[] {
  const out: string[] = []
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  let m: RegExpExecArray | null
  while ((m = rx.exec(text)) !== null && out.length < cap) out.push(m[0].trim())
  return out
}

// ── Structural fingerprint ───────────────────────────────────────────────────

export interface StructuralFingerprint {
  /** Ordered block-tag sequence, house style removed. */
  tags:       string[]
  /** First significant word of each H2, lowercased. */
  h2Openers:  string[]
  /** Words per section, for rhythm comparison. */
  sectionLengths: number[]
}

export function fingerprint(html: string): StructuralFingerprint {
  const body = stripMandatedSections(html)

  const tags: string[] = []
  const tagRe = /<(h2|h3|h4|p|ul|ol|table|blockquote)\b/gi
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(body)) !== null) tags.push(m[1].toLowerCase())

  const h2Openers: string[] = []
  const h2Re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi
  while ((m = h2Re.exec(body)) !== null) {
    const w = words(stripTags(m[1]))
    // Skip leading articles so "The Benefits of X" and "Benefits of X" match.
    const first = w.find(x => !['the', 'a', 'an'].includes(x))
    if (first) h2Openers.push(first)
  }

  const sectionLengths = body
    .split(/<h2\b/i)
    .slice(1)
    .map(s => words(stripTags(s)).length)

  return { tags, h2Openers, sectionLengths }
}

function trigrams(seq: string[]): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i + 2 < seq.length; i++) out.add(`${seq[i]}|${seq[i + 1]}|${seq[i + 2]}`)
  return out
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let inter = 0
  Array.from(a).forEach(x => { if (b.has(x)) inter++ })
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

function overlapRatio(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const sb = new Set(b)
  const hits = a.filter(x => sb.has(x)).length
  return hits / Math.max(a.length, b.length)
}

/**
 * How structurally interchangeable two posts are, 0-1.
 *
 * Weighted toward the tag sequence (the "same formatting of subheadings and
 * bullets" signal) with heading phrasing as a secondary term.
 */
export function structuralSimilarity(a: StructuralFingerprint, b: StructuralFingerprint): number {
  const tagSim = jaccard(trigrams(a.tags), trigrams(b.tags))
  const h2Sim  = overlapRatio(a.h2Openers, b.h2Openers)
  return 0.65 * tagSim + 0.35 * h2Sim
}

// ── The gate ─────────────────────────────────────────────────────────────────

export interface QualityGateInput {
  html:           string
  title?:         string | null
  targetKeyword?: string | null
  slug?:          string | null
  /** Existing published posts for the same client, for the corpus check. */
  siblings?:      { id: string; title: string | null; content: string | null }[]
  /**
   * Every URL known to exist on the client's site (cached sitemap rows).
   *
   * The generator's cannibalization guard is built from exactly this data, so
   * when it is empty the guard ran blind — and that is worth saying out loud
   * rather than letting a duplicate ship quietly.
   */
  siteUrls?:      string[]
  /** Adds financial-claim checks. */
  regulated?:     boolean
}

/** Words too common in slugs to count as evidence of the same topic. */
const SLUG_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'your',
  'you', 'my', 'is', 'are', 'do', 'does', 'how', 'what', 'why', 'when', 'best',
  'guide', 'blog', 'post', 'right', 'need', 'vs', 'versus', 'top', 'new',
])

function slugTokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/\.(html?|php|aspx)$/i, '')
      .split(/[^a-z0-9]+/)
      .filter(w => w.length > 2 && !SLUG_STOPWORDS.has(w)),
  )
}

/**
 * Overlap weighted by how DISTINCTIVE each shared word is on this particular site.
 *
 * A plain token count does not work here. For a client called Cyrious Plasma
 * Tables, the words "cnc", "plasma" and "table" appear in nearly every URL, so
 * unweighted containment scores three unrelated articles at 75% and buries the
 * one real duplicate among them. Those words describe the whole site; they carry
 * no information about which page this is.
 *
 * Weighting each word by inverse document frequency across the client's own URLs
 * fixes that: site-wide vocabulary contributes almost nothing, and a rare word
 * like "size" — the word that actually makes two posts the same article —
 * dominates the score.
 */
function weightedContainment(
  mine: Set<string>,
  theirs: Set<string>,
  idf: Map<string, number>,
): { score: number; shared: string[] } {
  if (mine.size === 0 || theirs.size === 0) return { score: 0, shared: [] }
  const w = (t: string) => idf.get(t) ?? 1
  const mineArr = Array.from(mine)
  const shared = mineArr.filter(t => theirs.has(t))
  // Denominator is the smaller side's total weight, so "same topic, longer title"
  // still scores high.
  const theirsArr = Array.from(theirs)
  const mineWeight   = mineArr.reduce((s, t) => s + w(t), 0)
  const theirsWeight = theirsArr.reduce((s, t) => s + w(t), 0)
  const denom = Math.min(mineWeight, theirsWeight)
  if (denom === 0) return { score: 0, shared: [] }
  const sharedWeight = shared.reduce((s, t) => s + w(t), 0)
  return { score: sharedWeight / denom, shared }
}

/** IDF for every token across the client's own URL set. */
function buildIdf(urls: string[]): Map<string, number> {
  const df = new Map<string, number>()
  for (const u of urls) {
    const seen = slugTokens(lastSegment(u))
    Array.from(seen).forEach(t => df.set(t, (df.get(t) ?? 0) + 1))
  }
  const n = Math.max(urls.length, 1)
  const idf = new Map<string, number>()
  Array.from(df.entries()).forEach(([t, d]) => {
    idf.set(t, Math.log(n / (1 + d)) + 1)   // +1 keeps every weight positive
  })
  return idf
}

/** Last meaningful path segment of a URL. */
function lastSegment(url: string): string {
  try {
    const segs = new URL(url).pathname.split('/').filter(Boolean)
    return segs[segs.length - 1] ?? ''
  } catch { return '' }
}

const SIM_WARN     = 0.82
const SIM_CRITICAL = 0.90

export function runQualityGate(input: QualityGateInput): QualityReport {
  const findings: QualityFinding[] = []
  const html = input.html ?? ''
  const text = stripTags(html)
  const wordList = words(text)
  const wordCount = wordList.length

  // ── Compliance with the prompt's own ban list ──────────────────────────────
  const tells = findPhrases(text, AI_TELL_PHRASES)
  if (tells.length > 0) {
    findings.push({
      code: 'ai_tell_phrases',
      severity: tells.length >= 3 ? 'critical' : 'warning',
      message: `${tells.length} banned AI-tell phrase${tells.length === 1 ? '' : 's'} survived generation. These are explicitly forbidden by the writer prompt, so the model ignored the instruction here.`,
      evidence: tells.slice(0, 6),
    })
  }

  const emDashes = (html.match(/—/g) ?? []).length
  if (emDashes > 0) {
    findings.push({
      code: 'em_dashes',
      severity: 'warning',
      message: `${emDashes} em dash${emDashes === 1 ? '' : 'es'} present. The prompt bans this character outright; it is one of the most recognisable machine-writing tells.`,
    })
  }

  // ── Padding ───────────────────────────────────────────────────────────────
  const padding = findPhrases(text, PADDING_PHRASES)
  const per1k = wordCount > 0 ? (padding.length / wordCount) * 1000 : 0
  if (padding.length >= 2 && per1k >= 1.2) {
    findings.push({
      code: 'padding_phrases',
      severity: 'warning',
      message: `Filler language at ${per1k.toFixed(1)} instances per 1,000 words. "Three sentences expanded into 500 words" was called out by name in reporting on the spam update.`,
      evidence: padding.slice(0, 6),
    })
  }

  const sents = sentences(text)
  const avgSentence = sents.length > 0 ? wordCount / sents.length : 0
  if (avgSentence > 30) {
    findings.push({
      code: 'sentence_bloat',
      severity: 'info',
      message: `Average sentence runs ${avgSentence.toFixed(0)} words. Long uniform sentences usually mean padding rather than complexity.`,
    })
  }

  // ── Keyword handling ──────────────────────────────────────────────────────
  const kw = (input.targetKeyword ?? '').trim().toLowerCase()
  if (kw && wordCount > 0) {
    const kwWords = words(kw)
    if (kwWords.length > 0) {
      // Count phrase occurrences rather than individual words.
      const hay = wordList.join(' ')
      const needle = kwWords.join(' ')
      let count = 0, idx = 0
      while ((idx = hay.indexOf(needle, idx)) !== -1) { count++; idx += needle.length }
      const density = (count * kwWords.length) / wordCount
      if (density > 0.025) {
        findings.push({
          code: 'keyword_stuffing',
          severity: density > 0.035 ? 'critical' : 'warning',
          message: `Target keyword appears ${count} times (${(density * 100).toFixed(1)}% density). Content "strongly focused on keywords" was reported as a direct target of the update.`,
        })
      }
    }

    // Title-cased keyword in headings is the auto-capitalisation pattern the
    // update was reported to penalise.
    const headings = collectMatches(html, /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi, 30)
      .map(h => stripTags(h))
    const titleCased = headings.filter(h => {
      const lower = h.toLowerCase()
      if (!lower.includes(kw)) return false
      const start = lower.indexOf(kw)
      const asWritten = h.slice(start, start + kw.length)
      // Every keyword word capitalised inside a heading that is not itself fully
      // title-cased reads as mechanical insertion.
      return asWritten.split(/\s+/).filter(Boolean).every(w => /^[A-Z]/.test(w))
        && asWritten !== h.trim()
    })
    if (titleCased.length >= 2) {
      findings.push({
        code: 'keyword_capitalisation',
        severity: 'warning',
        message: `The target keyword appears title-cased inside ${titleCased.length} headings. Auto keyword-capitalisation was named as a targeted pattern.`,
        evidence: titleCased.slice(0, 4),
      })
    }
  }

  // ── Regulated claims ──────────────────────────────────────────────────────
  const promises = PROMISE_PATTERNS.filter(p => p.re.test(text))
  if (promises.length > 0) {
    findings.push({
      code: 'outcome_promise',
      severity: 'critical',
      message: `Promises an approval outcome. Nobody can guarantee a lending decision, and this is a compliance exposure, not a style note.`,
      evidence: promises.map(p => p.label),
    })
  }

  if (input.regulated) {
    const hasSource = SOURCE_MARKERS.test(text)
    for (const pat of FINANCIAL_FIGURE_PATTERNS) {
      const hits = collectMatches(text, pat.re)
      if (hits.length === 0) continue
      findings.push({
        code: 'unverified_financial_figure',
        severity: hasSource ? 'warning' : 'critical',
        message: `Contains ${pat.label}${hasSource ? '' : ' with no named source anywhere in the post'}. Verify every figure came from supplied data, or remove it — an invented rate is a compliance problem.`,
        evidence: hits,
      })
    }
  }

  // ── Corpus sameness ───────────────────────────────────────────────────────
  const siblings = (input.siblings ?? []).filter(s => s.content && s.content.length > 200)
  if (siblings.length >= 3) {
    const mine = fingerprint(html)
    const scored = siblings
      .map(s => ({ post: s, sim: structuralSimilarity(mine, fingerprint(s.content!)) }))
      .sort((a, b) => b.sim - a.sim)

    const top = scored[0]
    const nearDupes = scored.filter(s => s.sim >= SIM_WARN)

    if (top && top.sim >= SIM_CRITICAL) {
      findings.push({
        code: 'structural_duplication',
        severity: 'critical',
        message: `Structurally near-identical to ${nearDupes.length} existing post${nearDupes.length === 1 ? '' : 's'} on this site (closest ${(top.sim * 100).toFixed(0)}% match, house-style sections excluded). Pages sharing one skeleton across a site is the "same AI slop formatting" pattern the update targeted. Reshape this one: different section order, different heading phrasing, different mix of prose and lists.`,
        evidence: nearDupes.slice(0, 4).map(s => `${(s.sim * 100).toFixed(0)}% — ${s.post.title ?? s.post.id}`),
      })
    } else if (nearDupes.length >= 3) {
      findings.push({
        code: 'structural_sameness',
        severity: 'warning',
        message: `Shares a structural template with ${nearDupes.length} existing posts (closest ${(top.sim * 100).toFixed(0)}%). Not fatal on its own, but a whole site built to one shape is what gets filtered.`,
        evidence: nearDupes.slice(0, 4).map(s => `${(s.sim * 100).toFixed(0)}% — ${s.post.title ?? s.post.id}`),
      })
    }

    // Site-wide heading monotony, independent of any single pairing.
    const allOpeners = siblings.flatMap(s => fingerprint(s.content!).h2Openers)
    if (allOpeners.length >= 12) {
      const freq = new Map<string, number>()
      for (const o of allOpeners) freq.set(o, (freq.get(o) ?? 0) + 1)
      const [word, n] = Array.from(freq.entries()).sort((a, b) => b[1] - a[1])[0] ?? ['', 0]
      const share = n / allOpeners.length
      if (share > 0.3) {
        findings.push({
          code: 'heading_monotony',
          severity: 'info',
          message: `${(share * 100).toFixed(0)}% of H2 headings across this client's posts start with "${word}". Vary how sections are introduced.`,
        })
      }
    }
  }

  // ── Cannibalising a page that already exists on the site ──────────────────
  //
  // The generator's avoid-list is built from cached sitemap rows. When the
  // sitemap never parsed, that list is empty and the model is told nothing about
  // the client's existing articles — so it will happily write a second version of
  // one. This is the backstop for that, checked against the URLs rather than
  // against our own database, because the database only knows the posts WE made.
  const siteUrls = input.siteUrls ?? []
  const mineTokens = new Set(
    Array.from(slugTokens(input.slug ?? '')).concat(Array.from(slugTokens(input.targetKeyword ?? ''))),
  )

  if (siteUrls.length === 0) {
    findings.push({
      code: 'cannibalisation_unchecked',
      severity: 'warning',
      message: 'No sitemap pages are cached for this client, so the generator had no list of existing articles to avoid — this post may duplicate one already on the site. Fetch the sitemap on the client\'s Sitemap tab, then regenerate or re-check.',
    })
  } else if (mineTokens.size >= 2) {
    const idf = buildIdf(siteUrls)
    const matches = siteUrls
      .map(u => ({ url: u, ...weightedContainment(mineTokens, slugTokens(lastSegment(u)), idf) }))
      // HIGH BAR ON PURPOSE. Measured against this client's real 102-URL sitemap,
      // the genuine duplicate scores 1.00 while every other article about the same
      // product line clusters at 0.66 — they share the house vocabulary and nothing
      // else. A 0.6 cut-off would raise eight warnings on every post, which teaches
      // people to dismiss the check; 0.8 raises exactly the one that matters.
      // This finding blocks unattended publishing, so precision beats recall here —
      // the corpus-sameness check and human review still cover the near misses.
      .filter(m => m.shared.length >= 2 && m.score >= 0.8)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)

    if (matches.length > 0) {
      const worst = matches[0]
      findings.push({
        code: 'cannibalisation_risk',
        severity: 'critical',
        message: `This targets substantially the same topic as a page already on the client's site (${Math.round(worst.score * 100)}% match on the words that actually distinguish their pages from each other). Two pages competing for one query is worse than either alone. Re-angle it to a genuinely different search intent, or update the existing article instead of adding a second one.`,
        evidence: matches.map(m => `${m.url}  — shared: ${m.shared.join(', ')}`),
      })
    }
  }

  // ── Thin content ──────────────────────────────────────────────────────────
  if (wordCount > 0 && wordCount < 400) {
    findings.push({
      code: 'thin_content',
      severity: 'warning',
      message: `Only ${wordCount} words. Either it needs more substance or the topic did not warrant a post.`,
    })
  }

  const critical = findings.filter(f => f.severity === 'critical').length
  const warning  = findings.filter(f => f.severity === 'warning').length
  const score = Math.max(0, 100 - critical * 25 - warning * 8)

  return {
    findings,
    score,
    blocksAutoPush: critical > 0,
    wordCount,
  }
}
