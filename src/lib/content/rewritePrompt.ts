// Rich system prompt for the REGENERATE / rewrite paths, so a regenerated post carries
// the same internal-link allow-list, external-source rule, E-E-A-T, writer-quality bar,
// and (for blogs) the FAQ + Key Takeaways structure that a fresh generation gets.
//
// The two regenerate routes previously hand-rolled a one-line system prompt, which is why
// regenerated posts came out with no internal links, no named sources, and no FAQ.

import { WRITER_QUALITY_RULES, BLOG_STRUCTURE_RULES, BLOG_WRITER_INTENT_REMINDER } from './blogStrategy'

const JSON_FORMAT = `Return ONLY a valid JSON object — no markdown fences, no text before or after — with exactly these fields:
{ "title": "H1 title including the focus keyword", "content": "Full HTML body (h2, h3, p, ul, strong, a tags — no <h1>)", "metaDescription": "150–160 characters including the focus keyword", "slug": "url-friendly-slug" }`

const CORE_RULES = `Your writing demonstrates E-E-A-T (Experience, Expertise, Authority, Trustworthiness): weave in the business's real expertise, credentials, and specifics where relevant.
EXTERNAL SOURCES: reference credible sources (government agencies, studies, industry publications) BY NAME in the prose where factually relevant — do NOT insert hyperlinks to external websites.
TABLES: avoid HTML tables unless the data is genuinely comparative (≤4 rows, ≤3 columns); otherwise use bullet lists or prose.`

/**
 * Build the rewrite system prompt. Pass the client's internal-link allow-list so the model
 * can produce valid internal links (without it, any link it invents gets stripped → zero links).
 */
export function buildRewriteSystemPrompt(params: {
  agency:       string
  allowedUrls?: string[]
  isBlog?:      boolean
}): string {
  const isBlog = params.isBlog !== false
  const urls   = (params.allowedUrls ?? []).filter(Boolean).slice(0, 60)

  const linkBlock = urls.length
    ? `\n\nINTERNAL LINKS — CRITICAL: include 2–5 internal links using ONLY URLs from this list, character-for-character (never invent, guess, or modify a URL), with descriptive anchor text (never "click here"):\n${urls.map(u => `- ${u}`).join('\n')}`
    : `\n\nINTERNAL LINKS: only link to real pages already on the client's own site; if no specific URL is available, do not invent one.`

  return `You are a professional SEO content writer for ${params.agency}.

${JSON_FORMAT}

${CORE_RULES}${linkBlock}

${WRITER_QUALITY_RULES}${isBlog ? `\n\n${BLOG_STRUCTURE_RULES}\n\n${BLOG_WRITER_INTENT_REMINDER}` : ''}`
}
