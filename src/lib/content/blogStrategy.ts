// Canonical blog-intent strategy — the single MACHINE source of truth.
//
// Imported by the topic engine (src/lib/content/generateTopics.ts) and the writer
// route (src/app/api/admin/content/generate/route.ts) so the rule text exists once.
//
// The human-readable companion spec lives at .claude/skills/blog-strategy/SKILL.md.
// Markdown cannot be imported at runtime, so THIS file is authoritative; when the
// rules change, update the SKILL.md to match.
//
// Why this exists: blog topics were driven almost entirely by Google Search Console
// query data. When a client ranks for "near me" queries, GSC surfaces them and the
// engine wrote "near me" blog posts — transactional/core-page intent masquerading as
// blog content, which does NOT build the topical authority that actually moves
// rankings. Blogs must be educational and SUPPORT the money pages, never compete.

// Allowed search-intent values for a BLOG post (informational/educational only).
export const BLOG_INTENT_ENUM =
  'informational | how_to | faq | comparison | cost_pricing | problem_solution | buyer_education'

// The original enum — still correct for service_page / regular_page generation,
// where local_service / commercial / emergency intent is legitimate.
export const NON_BLOG_INTENT_ENUM =
  'informational | commercial | local_service | comparison | cost_pricing | how_to | faq | emergency'

// Hard-rule block injected into the topic-generation system prompt for blogs.
export const BLOG_INTENT_GUARDRAIL = `
BLOG INTENT GUARDRAIL (HARD RULE — applies to every topic):
Blog posts exist to build TOPICAL AUTHORITY and answer real questions. They may ONLY serve INFORMATIONAL / EDUCATIONAL intent. Allowed angles: how-to guide, step-by-step tutorial, FAQ / question-and-answer, explainer ("what is / how does / signs of"), problem to solution, buyer education, cost / pricing explainer, comparison (A vs B), checklist, mistakes to avoid, maintenance or seasonal guide, definitions / glossary.

FORBIDDEN as a blog topic (these belong to service pages or the homepage — never write a blog post for them):
- Bare "near me" queries, or a pure geo + service phrase used AS the target_keyword (e.g. "plumber near me", "roof repair Dallas", "emergency electrician Austin").
- Transactional / hire-now intent ("book a plumber", "get a quote", "[service] company", "[service] cost near me" as a landing page).
- Branded or navigational intent (the client's own business name, "[brand] reviews", "[brand] phone number", contact / directions / login).

REFRAME RULE for "near me" and local-service GSC signals: when a GSC opportunity is a "near me" or geo+service query, DO NOT target that phrase. Identify the EDUCATIONAL question a searcher asks on the way to that purchase and target THAT as an informational cluster article that internally links to the page currently ranking for the near-me term.
Example: GSC shows "emergency plumber near me" ranking on /emergency-plumbing → write "What Counts as a Plumbing Emergency (and What to Do Before the Plumber Arrives)" and internally link it to /emergency-plumbing.

Every target_keyword you return for a blog MUST be phrased as a question or an informational noun phrase — NEVER a bare service+location or "near me" phrase.`.trim()

// Prompt paragraph that grounds topic selection in the business + its search landscape.
export const BLOG_LANDSCAPE_INSTRUCTION = `
UNDERSTAND THE BUSINESS AND ITS SEARCH LANDSCAPE BEFORE PICKING TOPICS:
1. From the business background, services, target audience, geographic focus, and E-E-A-T signals, infer the client's MONEY PAGES (the service and core pages that earn revenue).
2. Treat the Google Search Console data as a map of real demand: top pages show what already ranks, page-2 and near-page-1 queries show where authority is thin. These are DESTINATIONS for internal links, not blog titles.
3. Every blog topic you propose must be an educational article a real person would search for on the way to needing one of those money pages, and must be assignable to exactly one money page it supports via an internal link. State that supporting page in "ranking_strategy".`.trim()

// One-line reminder appended to the WRITER system prompt so a stale/pre-existing
// near-me topic doesn't yield a near-me article at write time.
export const BLOG_WRITER_INTENT_REMINDER =
  'BLOG INTENT: Write an educational, informational article that answers a real question and builds topical authority. Do NOT write a "near me", location+service landing, or hire-now sales page — this is a blog post that SUPPORTS the money pages via internal links, never competes with them.'

// ─────────────────────────────────────────────────────────────────────────────
// WRITER QUALITY BAR (Tier 1)
//
// Anti-"AI-tell" voice rules, punctuation discipline, structure requirements
// (Key Takeaways box, clean heading hierarchy), evidence/citation honesty, and a
// silent self-check. Appended to the WRITER system prompt for every post so the
// output reads like an experienced practitioner, not generic AI filler.
//
// Adapted for this app's constraints (HTML output, internal-links-only, no external
// hyperlinks, no tables). Voice/quality technique inspiration: the open-source
// claude-blog agent prompts by AgriciDaniel (MIT) — see
// docs/reference/claude-blog-writer.md and docs/reference/claude-blog-seo.md.
// ─────────────────────────────────────────────────────────────────────────────
// Universal quality bar — applies to EVERY content type (blog, service page, regular
// page). Voice, banned phrases, punctuation, heading hierarchy, citation honesty,
// self-check. (Blog-only structure like the Key Takeaways box lives in
// BLOG_STRUCTURE_RULES below so it is not forced onto service/landing pages.)
export const WRITER_QUALITY_RULES = `
WRITER QUALITY BAR — applies to every sentence. These rules separate expert content from generic AI output:

VOICE & ORIGINALITY
- Lead with substance a reader cannot get from a generic article on this topic: a specific number, a concrete example, a real trade-off, a named tool/material/step, or a first-hand process detail. Do not restate common knowledge as if it were insight.
- Start every paragraph with its most important sentence. One idea per paragraph. Let the point decide the length — never pad to hit a word count.
- Active voice. Natural, confident, conversational tone — write the way an experienced practitioner explains something to a customer, not the way a brochure sounds. Do not open two adjacent paragraphs the same way.

BANNED AI-TELL PHRASES — do NOT use these or close variants; rewrite with plainer, specific wording:
"in today's digital landscape", "in today's fast-paced world", "in the ever-evolving", "when it comes to", "it's important to note", "it's worth noting", "needless to say", "dive into", "delve into", "let's explore", "let's take a look", "game-changer", "navigate the landscape", "navigating the world of", "revolutionize", "seamless"/"seamlessly", "cutting-edge", "state-of-the-art", "harness the power of", "leverage" (as a verb — use "use"), "unlock", "elevate", "empower", "robust", "streamline", "top-notch", "look no further", "rest assured", "at the end of the day", "the world of", "a myriad of", "plethora", "it goes without saying".

PUNCTUATION
- Do NOT use the em dash character (—, U+2014). Replace it with a comma, colon, period, parentheses, or a plain hyphen where grammatically correct.
- Avoid the "not only X but also Y" and "whether you're X or Y" constructions and rhetorical-question openers ("Ever wondered…?") — they read as AI filler.

STRUCTURE
- Exactly one H1 (the title). H2 for main sections, H3 for subsections. Never skip a heading level (no H2 followed directly by H4).

EVIDENCE & CLAIMS
- Support any statistic or factual claim by naming its source in the prose (e.g. "according to the EPA"). Never invent statistics, studies, dates, or quotes. If you are not confident a number is real, make the point qualitatively instead.
- Mark genuinely original material with an HTML comment the reader never sees, so an editor can spot the value-add: <!-- INSIGHT: ... --> for a non-obvious analysis, <!-- EXPERIENCE: ... --> for a first-hand or process detail. No minimum count; only where the value is real.

SELF-CHECK before returning the JSON — silently verify and fix:
- Zero em dashes; no banned phrases remain.
- Every claim has context; every statistic names a source.
- Clean heading hierarchy (H1 → H2 → H3, no skipped levels).
- Natural tone throughout; no two adjacent paragraphs open with the same word or structure.
- Meta description accurately reflects the visible content and reads naturally.`.trim()

// Blog-ONLY structure. Appended to the writer prompt only for content_type 'blog'
// (via BLOG_WRITER_INTENT_REMINDER's gating) so service/landing pages are not forced
// to carry a Key Takeaways box or FAQ.
export const BLOG_STRUCTURE_RULES = `
BLOG STRUCTURE (blog posts only):
- Immediately AFTER the introduction, output a Key Takeaways box: an <h2>Key Takeaways</h2> followed by a <ul> of 3–5 self-contained bullets summarizing the post's key findings or recommendations. Each bullet must make sense on its own; include a specific fact or number only when it genuinely helps.
- Include a real FAQ section (H2 "Frequently Asked Questions" with question H3s) ONLY when the topic naturally raises follow-up questions — never as filler.
- Before returning, confirm the Key Takeaways box is present right after the intro.`.trim()

/** @deprecated Use WRITER_QUALITY_RULES (universal) + BLOG_STRUCTURE_RULES (blog only). */
export const BLOG_WRITER_QUALITY_RULES = WRITER_QUALITY_RULES

const BLOG_INTENT_ALLOWED = new Set(BLOG_INTENT_ENUM.split('|').map(s => s.trim()))

/**
 * Return true if the allowed blog-intent set contains `intent`.
 * Used to relabel any non-informational intent the model slips through.
 */
export function isAllowedBlogIntent(intent: string | null | undefined): boolean {
  return !!intent && BLOG_INTENT_ALLOWED.has(intent.trim())
}

/**
 * Safety-net validator. The prompt is primary enforcement; this catches leaks.
 * True when the keyword is transactional/local intent that doesn't belong on a blog.
 */
export function isForbiddenBlogKeyword(kw: string | null | undefined): boolean {
  if (!kw) return false
  const k = kw.toLowerCase()
  if (/\bnear me\b/.test(k)) return true
  if (/\b(quote|hire|book|appointment|company|contractor)\b/.test(k)) return true
  return false
}
