import { buildEditorialStandards, isRegulatedVertical } from '@/lib/content/editorialStandards'
import { runQualityGate } from '@/lib/content/qualityGate'
import { attachPostToKeyword } from '@/lib/content/siloQueue'
import { describeTenure } from '@/lib/content/eeat'
import type { EeatData } from '@/lib/content/types'
import { NextRequest, NextResponse } from 'next/server'
import { PLATFORM_BOT_UA } from '@/lib/platformBot'
import { stripHallucinatedLinks } from '@/lib/content/linkUtils'
import { styleTables } from '@/lib/content/contentHtml'
import { waitUntil } from '@vercel/functions'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import type { AdminSession } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { parseBody } from '@/lib/apiError'
import { sendEmail } from '@/lib/email'
import { sendDiscordMessage } from '@/lib/discord'
import { getNotif, type NotifConfig } from '@/lib/notificationConfig'
import { scoreSeoPost } from '@/lib/content/scoreSeoPost'
import { generatePostImage } from '@/lib/content/generatePostImage'
import { formatBriefForPrompt } from '@/lib/content/siloEngine'
import { BLOG_WRITER_INTENT_REMINDER, WRITER_QUALITY_RULES, BLOG_STRUCTURE_RULES } from '@/lib/content/blogStrategy'
import { gatherCompetitorGap } from '@/lib/content/competitiveIntel'
import { registerKeyword } from '@/lib/content/seoRankings'
import type { SeoBrief } from '@/lib/content/types'
import type { OptimizationBrief } from '@/lib/types'

export const maxDuration = 300

/**
 * POST /api/admin/content/generate
 *
 * Two input paths:
 *   1. { topic_id }           — background generation from an approved topic
 *   2. { prompt, client_id? } — synchronous manual generation (ContentEditor needs the response)
 *
 * Returns: { ok, queued } for topic_id path; { post_id, title, ... } for prompt path
 */

// ─── Types ────────────────────────────────────────────────────────────────────

type TopicData = {
  id:                     string
  topic:                  string
  rationale:              string | null
  target_keyword:         string | null
  page_to_support:        string | null
  client_id:              string
  target_publish_date:    string | null
  search_intent:          string | null
  secondary_keywords:     string | null
  seo_brief:              SeoBrief | null
  competitors_researched: { keyword: string; urls: string[]; headings: Record<string, string[]> } | null
  edit_notes:             string | null
  silo_id:                string | null
  content_type:           string | null
  custom_focus:           string | null
  custom_slug:            string | null
}

type AgencySettings = {
  ai_provider:                string | null
  ai_model:                   string | null
  ai_api_key:                 string
  openai_api_key:             string | null
  agency_name:                string | null
  notification_email:         string | null
  notify_post_generated:      boolean | null
  notify_post_uploaded:       boolean | null
  master_writing_prompt:      string | null
  service_page_master_prompt: string | null
  regular_page_master_prompt: string | null
  discord_bot_token:          string | null
  serp_api_key:               string | null
}

// ─── Sitemap fetching ─────────────────────────────────────────────────────────

function extractSitemapLocs(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc>\s*(https?:\/\/[^\s<]+)\s*<\/loc>/gi)).map(m => m[1].trim())
}

// Returns { pages: URLs for internal linking, blogPosts: URLs from post/blog sub-sitemaps }
// Handles both flat sitemaps and sitemap indexes (one level deep).
async function fetchSitemapData(sitemapUrl: string): Promise<{ pages: string[]; blogPosts: string[] }> {
  const empty = { pages: [], blogPosts: [] }
  try {
    const res = await fetch(sitemapUrl, {
      signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': PLATFORM_BOT_UA },
    })
    if (!res.ok) return empty
    const xml = await res.text()
    const locs = extractSitemapLocs(xml)

    if (xml.includes('<sitemapindex')) {
      // Sitemap index — follow sub-sitemaps in parallel (capped at 10)
      const subUrls = locs.filter(u => u.endsWith('.xml')).slice(0, 10)
      const pages: string[]     = []
      const blogPosts: string[] = []
      await Promise.all(subUrls.map(async subUrl => {
        try {
          const sub = await fetch(subUrl, {
            signal: AbortSignal.timeout(4000),
            headers: { 'User-Agent': PLATFORM_BOT_UA },
          })
          if (!sub.ok) return
          const subLocs = extractSitemapLocs(await sub.text()).filter(u => !u.endsWith('.xml'))
          // Categorise by sub-sitemap URL — "post", "blog", "article", "news" → blog posts
          if (/post|blog|article|news/i.test(subUrl)) {
            blogPosts.push(...subLocs)
          } else {
            pages.push(...subLocs)
          }
        } catch { /* non-fatal */ }
      }))
      return { pages: pages.slice(0, 40), blogPosts: blogPosts.slice(0, 150) }
    }

    // Flat sitemap — all locs are pages
    return { pages: locs.filter(u => !u.endsWith('.xml')).slice(0, 40), blogPosts: [] }
  } catch {
    return empty
  }
}

// Kept for compatibility — returns only page URLs
async function fetchSitemapPages(sitemapUrl: string): Promise<string[]> {
  const { pages, blogPosts } = await fetchSitemapData(sitemapUrl)
  return [...pages, ...blogPosts]
}

function scoreUrlRelevance(url: string, keywords: string[]): number {
  const path = url.toLowerCase().replace(/[-_/]/g, ' ')
  return keywords.reduce((score, kw) => {
    const words = kw.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    return score + words.filter(w => path.includes(w)).length
  }, 0)
}

// ─── GSC internal link suggestions ───────────────────────────────────────────

async function getGscInternalLinks(
  db: ReturnType<typeof createAdminClient>,
  clientId: string,
  keyword: string | null
): Promise<{ url: string; query: string; position: number; impressions: number }[]> {
  const windowStart = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10)

  const { data: rows } = await db
    .from('gsc_metrics')
    .select('page, query, impressions, position')
    .eq('client_id', clientId)
    .gte('date', windowStart)
    .gt('position', 9)
    .lt('position', 21)
    .gt('impressions', 3)
    .not('page', 'ilike', '%?%')

  if (!rows || rows.length === 0) return []

  const pageMap = new Map<string, { totalImpr: number; weightedPos: number; bestQuery: string }>()
  for (const r of rows) {
    const page = r.page as string
    const impr = (r.impressions as number) ?? 0
    const pos  = (r.position   as number) ?? 0
    const q    = (r.query      as string) ?? ''
    const ex   = pageMap.get(page)
    if (ex) {
      const newImpr = ex.totalImpr + impr
      ex.weightedPos = newImpr > 0 ? (ex.weightedPos * ex.totalImpr + pos * impr) / newImpr : ex.weightedPos
      ex.totalImpr   = newImpr
    } else {
      pageMap.set(page, { totalImpr: impr, weightedPos: pos, bestQuery: q })
    }
  }

  const keywordWords = keyword
    ? keyword.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    : []

  return Array.from(pageMap.entries())
    .map(([url, agg]) => ({
      url,
      query:       agg.bestQuery,
      position:    Math.round(agg.weightedPos * 10) / 10,
      impressions: agg.totalImpr,
      relevant:    keywordWords.length > 0 &&
                   keywordWords.some(w => agg.bestQuery.toLowerCase().includes(w)),
    }))
    .sort((a, b) => {
      if (a.relevant !== b.relevant) return a.relevant ? -1 : 1
      return b.impressions - a.impressions
    })
    .slice(0, 6)
    .map(({ url, query, position, impressions }) => ({ url, query, position, impressions }))
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatEeat(eeatRaw: unknown): string {
  if (!eeatRaw) return ''
  const e = typeof eeatRaw === 'string' ? (() => { try { return JSON.parse(eeatRaw) } catch { return null } })() : eeatRaw
  if (!e || typeof e !== 'object') return String(eeatRaw)
  const r = e as Record<string, unknown>
  const parts: string[] = []
  { const tenure = describeTenure(r as Partial<EeatData>); if (tenure) parts.push(tenure) }
  if (r.licenses)               parts.push(`licensed/certified: ${r.licenses}`)
  if (r.review_count)           parts.push(`${r.review_count} reviews`)
  if (r.owner_details)          parts.push(`owner: ${r.owner_details}`)
  if (r.guarantees)             parts.push(`guarantees: ${r.guarantees}`)
  if (r.emergency_availability) parts.push('24/7 emergency service')
  if (r.phone_number)           parts.push(`phone: ${r.phone_number}`)
  if (r.team_experience)        parts.push(String(r.team_experience))
  if (r.awards)                 parts.push(String(r.awards))
  const rest = ['brands_used','financing_options','warranties','insurance','case_studies']
    .filter(k => r[k]).map(k => String(r[k]))
  return [...parts, ...rest].join('. ')
}

function mergePostStructures(globalStructure?: string | null, clientStructure?: string | null): string {
  if (!globalStructure && !clientStructure) return ''
  if (!clientStructure) return globalStructure ?? ''
  if (!globalStructure) return clientStructure
  return `${globalStructure}\n\nClient-specific additions:\n${clientStructure}`
}

function parseManualLinks(manualLinkUrls: string[]): { url: string; label: string }[] {
  return (manualLinkUrls ?? []).flatMap(s => {
    try {
      const p = JSON.parse(s)
      if (p && typeof p === 'object' && p.url) return [{ url: String(p.url), label: String(p.label ?? '') }]
    } catch { /* ignore */ }
    if (typeof s === 'string' && s.startsWith('http')) return [{ url: s, label: '' }]
    return []
  })
}

function repairJsonStrings(json: string): string {
  let out = '', inStr = false, esc = false
  for (const ch of json) {
    if (esc)                          { out += ch; esc = false; continue }
    if (ch === '\\' && inStr)         { out += ch; esc = true;  continue }
    if (ch === '"')                   { out += ch; inStr = !inStr; continue }
    if (inStr && ch === '\n')         { out += '\\n'; continue }
    if (inStr && ch === '\r')         { out += '\\r'; continue }
    if (inStr && ch === '\t')         { out += '\\t'; continue }
    out += ch
  }
  return out
}

// Replace em dashes (—) and en dashes (–) in text nodes only — not inside HTML tags/attributes.
// LLMs ignore prompt-level rules for these characters; post-processing is the reliable fix.
function sanitizeEmDashes(html: string): string {
  // Split on HTML tags, replace dashes only in text segments
  return html.replace(/(<[^>]*>)|([^<]+)/g, (_, tag, text) => {
    if (tag) return tag
    return text
      .replace(/—/g, ' - ')  // em dash → space-hyphen-space
      .replace(/–/g, '-')    // en dash → hyphen
  })
}

// Strips HTML tags that should never appear in AI-generated blog content.
// Defends against jailbroken or misconfigured model output and prompt injection.
function stripDangerousHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^>]*\/?>/gi, '')
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, '')
    // Event handlers — any whitespace separator (space, tab, newline), both quoted and unquoted values
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
    // javascript: URIs — capture and preserve the quote type to avoid attribute-boundary corruption
    .replace(/\bhref(\s*=\s*)(["'])\s*javascript:/gi, 'href$1$2javascript_removed:')
    .replace(/\bsrc(\s*=\s*)(["'])\s*javascript:/gi,  'src$1$2javascript_removed:')
}

// Strips <h1> tags from post body — the CMS uses the title field as the page H1;
// a duplicate H1 in content causes SEO errors.
function stripH1FromContent(html: string): string {
  return html.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi, '')
}

// Strips links whose visible text is a generic filler phrase ("click here", "here", "learn more", etc.).
// The URL is preserved in the preceding or following context as plain text.
const GENERIC_ANCHOR_RE = /^(click here|here|learn more|read more|this page|this article|this post|more info(?:rmation)?|find out more|check it out|visit|link|page|website|site pages?)\.?$/i
function stripGenericAnchorText(html: string): string {
  return html.replace(/<a\s([^>]*)>([\s\S]*?)<\/a>/gi, (match, _attrs: string, text: string) => {
    const visible = text.replace(/<[^>]+>/g, '').trim()
    if (GENERIC_ANCHOR_RE.test(visible)) {
      console.warn('[generate] stripped generic anchor text:', visible)
      return visible
    }
    return match
  })
}

// Returns false for URLs that are XML sitemaps, feeds, PHP scripts, or other non-HTML resources
// that should never appear in blog post link lists or be suggested to the AI as link targets.
function isLinkableUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const path = u.pathname.toLowerCase()
    if (path.includes('sitemap'))  return false
    if (path.endsWith('.xml'))     return false
    if (path.endsWith('.json') || path.endsWith('.csv') || path.endsWith('.pdf')) return false
    if (path.includes('/feed') || path.includes('/rss') || path.includes('/atom')) return false
    // PHP scripts with query strings (e.g. xmlsitemap.php?type=products&page=1)
    if (path.endsWith('.php') && u.search.length > 0) return false
    return true
  } catch { return false }
}

function parseResponse(rawText: string) {
  const stripped  = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  const jsonMatch = stripped.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    for (const attempt of [jsonMatch[0], repairJsonStrings(jsonMatch[0])]) {
      try {
        const parsed = JSON.parse(attempt)
        return {
          title:           sanitizeEmDashes(String(parsed.title           || '')),
          seoTitle:        sanitizeEmDashes(String(parsed.seoTitle        || parsed.title || '')),
          content:         sanitizeEmDashes(String(parsed.content         || '')),
          metaDescription: sanitizeEmDashes(String(parsed.metaDescription || '')),
          slug:            String(parsed.slug            || ''),
          focusKeyword:    String(parsed.focusKeyword    || ''),
          suggestedTags:   Array.isArray(parsed.suggestedTags) ? parsed.suggestedTags.map(String) : [],
        }
      } catch { /* try next */ }
    }
  }
  function extractStr(field: string): string {
    const m = rawText.match(new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*?)(?:"|$)`, 's'))
    return m ? m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\') : ''
  }
  const title   = sanitizeEmDashes(extractStr('title'))
  const content = sanitizeEmDashes(extractStr('content') || '')
  return {
    title,
    seoTitle:        sanitizeEmDashes(extractStr('seoTitle') || title),
    content,
    metaDescription: sanitizeEmDashes(extractStr('metaDescription')),
    slug:            extractStr('slug'),
    focusKeyword:    extractStr('focusKeyword'),
    suggestedTags:   [],
  }
}

function computeWordCount(html: string): number {
  return html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
}
function computeHeadingCount(html: string): number {
  return (html.match(/<h[234][^>]*>/gi) || []).length
}
function computeInternalLinks(html: string): number {
  return (html.match(/<a [^>]+>/gi) || []).filter(l => !l.includes('http://') && !l.includes('https://')).length
}

// ─── Link validator ───────────────────────────────────────────────────────────


// ─── FAQ JSON-LD schema injection ─────────────────────────────────────────────

function injectFaqSchema(html: string): string {
  // Match h2/h3 headings (with optional inline tags) whose text ends with '?',
  // followed by a <p> answer block. Strip tags from both to get plain text.
  const faqPattern = /<h[23][^>]*>([\s\S]*?)<\/h[23]>\s*<p[^>]*>([\s\S]*?)<\/p>/gi
  const items: { question: string; answer: string }[] = []
  let m: RegExpExecArray | null
  while ((m = faqPattern.exec(html)) !== null && items.length < 10) {
    const question = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    const answer   = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400)
    // Only treat as FAQ if the heading clearly ends with a question mark
    if (question.endsWith('?') && answer) items.push({ question, answer })
  }
  if (!items.length) return html
  const schema = {
    '@context': 'https://schema.org',
    '@type':    'FAQPage',
    mainEntity: items.map(i => ({
      '@type':        'Question',
      name:           i.question,
      acceptedAnswer: { '@type': 'Answer', text: i.answer },
    })),
  }
  // Escape </script> sequences inside JSON to prevent premature script-tag termination
  const safeJson = JSON.stringify(schema).replace(/<\//g, '<\\/')
  return html + `\n<script type="application/ld+json">${safeJson}</script>`
}

// ─── Slug utilities ───────────────────────────────────────────────────────────

function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

// Returns a slug guaranteed to be unique for this client — checks the DB and
// appends -2, -3, … if the base is already taken. Normalises the raw slug from
// the AI before checking so "Roof Repair" and "roof-repair" deduplicate correctly.
async function uniqueSlug(
  db: ReturnType<typeof createAdminClient>,
  clientId: string,
  rawSlug: string
): Promise<string> {
  const base = (rawSlug || 'post')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)

  const { data: existing } = await db
    .from('content_posts')
    .select('slug')
    .eq('client_id', clientId)
    .like('slug', `${base}%`)

  const taken = new Set((existing ?? []).map((r: { slug: string }) => r.slug))
  if (!taken.has(base)) return base

  for (let i = 2; i <= 99; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

// ─── System prompt ────────────────────────────────────────────────────────────

// Pull the NON-NEGOTIABLE RULES section out of the master prompt so we can
// re-append it at the very end — recency bias means the model is far more
// likely to honour rules it saw last, not rules buried at the top.
function extractNonNegotiableRules(masterPrompt: string): string {
  const m = masterPrompt.match(/##\s*NON-NEGOTIABLE RULES\s*\n([\s\S]*?)(?:\n---|\n##\s)/)
  return m ? m[1].trim() : ''
}

// Extract a concise, keyword-like seed from a free-form manual prompt for SERP
// research. Strips instruction verbs and "blog post about" scaffolding.
function extractManualSeed(prompt: string | null | undefined): string {
  return (prompt ?? '').trim()
    .replace(/^(please\s+)?(write|create|generate|draft|compose|produce|make|build)\s+(me\s+)?(a|an|the)?\s*/i, '')
    .replace(/^(blog\s+post|article|guide|page|post|piece|write[- ]up)\s+(about|on|covering|for|regarding)\s+/i, '')
    .replace(/["'.\s]+$/, '')
    .slice(0, 80)
    .trim()
}

// True only when the seed reads like a search query, not a leftover instruction
// sentence — prevents wasting a SERP call on "create a comprehensive guide comparing…".
function looksKeywordLike(seed: string): boolean {
  if (seed.length < 3) return false
  const words = seed.split(/\s+/).filter(Boolean)
  if (words.length > 8) return false
  if (/\b(write|create|generate|draft|explain|describe|compare|list|discuss|include|ensure|should|make sure)\b/i.test(seed)) return false
  return true
}

function buildSystemPrompt(
  agency: string,
  clientContext: string,
  avoidTopics: string,
  postStructure: string,
  masterPreamble?: string | null,
  blogReminder?: string | null,
  /** Purpose + regulated-claim standards. See editorialStandards.ts. */
  editorialStandards?: string | null
): string {
  // Appended last so it survives recency bias — keeps a stale near-me topic from
  // producing a near-me article at write time (see blogStrategy.ts).
  const blogIntentNote = blogReminder ? `\n\n${blogReminder}` : ''
  // Tier 1 writer-quality bar — anti-AI-tell voice, em-dash ban, clean heading
  // hierarchy, citation honesty. Universal (all content types). Blog-only structure
  // (Key Takeaways box, FAQ) is carried by blogReminder, gated at the call sites.
  const qualityNote = `\n\n${WRITER_QUALITY_RULES}`
  // Appended AFTER the writer-quality bar so the purpose-level standards (who
  // this is for, what must never be invented) are the last thing the model reads.
  const editorialNote = editorialStandards ? `\n\n${editorialStandards}` : ''
  const currentYear = new Date().getFullYear()
  const yearNote = `\nContent freshness — IMPORTANT: The current calendar year is ${currentYear}. All trend references, "this year", seasonal topics, and time-sensitive content must reflect ${currentYear}. Only reference ${currentYear - 1} explicitly when the topic is about the previous year's results or historical comparison.`

  const jsonFormat = `CRITICAL — OUTPUT FORMAT: You must respond with ONLY a valid JSON object. No markdown fences, no explanation, no text before or after the JSON. The object must have exactly these fields:
{
  "title": "Post H1 title — descriptive, includes focus keyword",
  "seoTitle": "SEO/meta title — max 60 chars",
  "content": "Full HTML post body (h2, h3, h4, p, ul, strong, a tags as needed)",
  "metaDescription": "150–160 characters, includes focus keyword",
  "slug": "url-friendly-slug-max-5-words",
  "focusKeyword": "primary target keyword phrase",
  "suggestedTags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}`

  const contextRules = clientContext ? `
How to use the client context above — MUST follow every rule:
- E-E-A-T: weave the business's background, services, geographic focus, and expertise naturally into the copy. Reference specific offerings, years in business, credentials, or named staff where contextually relevant to build real-world authority.
- Brand voice: adopt the tone and style described in the client context for the entire post — headings, body copy, and CTA alike.
- Priority pages: include internal links to at least 2 of the priority pages listed in the context. Anchor text must be descriptive and contextually natural — never generic ("click here").
- Excluded pages: never link to, cite, or reference any URL listed under excluded pages.
- Always-include links: every URL listed under "Always-include internal links" must appear somewhere in the post body with descriptive anchor text.
- INTERNAL LINKS — CRITICAL: You may ONLY use URLs that appear verbatim in the "Available site pages for internal linking" list, the "Priority pages" list, or any "Required internal links" list provided above. Do NOT invent, construct, guess, or derive any other internal URL — even if the page logically should exist. If a URL is not explicitly listed, do not link to it under any circumstances. Do NOT modify any URL in any way — do not prepend, append, or insert any path segment. Use each URL character-for-character as it appears in the list (e.g. if the list contains '/about/', link to '/about/' exactly — never '/services/about/' or '/en/about/').
- NEVER link to XML files, sitemaps, PHP scripts, feed or RSS URLs, search result pages, or any URL that is not a real HTML content page. Every permitted URL is already pre-filtered in the lists above.
- EXTERNAL LINKS: Do NOT insert hyperlinks to any external website. If you reference a credible source (government agency, study, publication), name it in the prose only — do not create a clickable link to it.
- AVOID HTML tables. Tables render poorly on mobile in WordPress. Only use a <table> when the data is genuinely comparative (≤4 rows, ≤3 columns); use bullet lists or prose for everything else.` : ''

  if (masterPreamble) {
    const rules = extractNonNegotiableRules(masterPreamble)
    const rulesReminder = rules
      ? `\n\n---\nNON-NEGOTIABLE RULES — THESE APPLY TO EVERY WORD OF YOUR OUTPUT. VIOLATIONS INVALIDATE THE POST:\n${rules}`
      : ''
    return `${masterPreamble}

${jsonFormat}
${clientContext ? `\n${clientContext}` : ''}
${contextRules}
${postStructure ? `\nPost structure to follow:\n${postStructure}` : ''}
${avoidTopics ? `\nCANNIBALIZATION PREVENTION — CRITICAL: the following titles and target keywords are already published or queued. Before writing, check your chosen focusKeyword and angle against every entry below:\n1. Do NOT target the same focus keyword (including plurals, minor rephrasing, or city-swap variants).\n2. Do NOT answer the same core user question or intent, even under a different title.\n3. Do NOT use a slug that starts with the same base as an existing post's slug.\n4. If the assigned topic is too close to an existing entry, pivot to a clearly adjacent subtopic — a different buyer stage, a different service facet, or a more specific long-tail angle.\n\nExisting covered content:\n${avoidTopics}` : ''}${yearNote}${rulesReminder}${qualityNote}${editorialNote}${blogIntentNote}`
  }

  return `You are a professional SEO content writer for ${agency}.

${jsonFormat}
${clientContext ? `\n${clientContext}` : ''}
${contextRules}
Your writing demonstrates E-E-A-T (Experience, Expertise, Authority, Trustworthiness).

Topic strategy:
- Answer real questions the target audience searches for
- Consider seasonal relevance and local industry angles — the current year is ${currentYear}
- Write about subjects tied to the business's services and value proposition
- Avoid vague titles; be specific and targeted
- Reference current year (${currentYear}) for fresh, relevant content; only use ${currentYear - 1} for historical comparison${yearNote}
${postStructure ? `\nPost structure to follow:\n${postStructure}` : ''}

SEO guidelines:
- Clear focus keyword in H1, first paragraph, and 2–3 subheadings
- ~1% keyword density (roughly once per 100 words)
- Meta description: 150–160 characters, includes focus keyword
- SEO title: max 60 chars, includes focus keyword
- URL slug: lowercase, hyphens, no stop words, max 5–6 words
- End with a clear call-to-action
- Reference credible sources (government agencies, studies, industry publications) by name in the prose where factually relevant — do NOT insert hyperlinks to external websites
- Add descriptive alt text to any <img> tags including the focus keyword
- INTERNAL LINKS — CRITICAL: ONLY use URLs that appear verbatim in the "Available site pages for internal linking" list provided in the client context. Do NOT invent, guess, or construct any internal URL. Any internal link to a URL not in that list is a critical error. Do NOT modify any URL in any way — do not prepend, append, or insert any path segment. Use each URL character-for-character as it appears in the list.
- NEVER link to XML files, sitemaps, PHP scripts, feeds, or any non-HTML page. External links are not permitted — mention sources by name only.
- AVOID HTML tables. Tables render poorly on mobile in WordPress. Only use a <table> when the data is genuinely comparative (≤4 rows, ≤3 columns); use bullet lists or prose for everything else.
${avoidTopics ? `\nCANNIBALIZATION PREVENTION — CRITICAL: the following titles and target keywords are already published or queued. Before writing, check your chosen focusKeyword and angle against every entry below:\n1. Do NOT target the same focus keyword (including plurals, minor rephrasing, or city-swap variants).\n2. Do NOT answer the same core user question or intent, even under a different title.\n3. Do NOT use a slug that starts with the same base as an existing post's slug.\n4. If the assigned topic is too close to an existing entry, pivot to a clearly adjacent subtopic — a different buyer stage, a different service facet, or a more specific long-tail angle.\n\nExisting covered content:\n${avoidTopics}` : ''}${qualityNote}${editorialNote}${blogIntentNote}`
}

// ─── AI call ──────────────────────────────────────────────────────────────────

async function callAI(
  provider: string,
  model: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 16000, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
    })
    if (!res.ok) throw new Error(`AI API error: ${await res.text()}`)
    const data = await res.json()
    const tb = data.content?.find((b: Record<string, unknown>) => b.type === 'text')
    return tb?.text || ''
  } else {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }),
    })
    if (!res.ok) throw new Error(`AI API error: ${await res.text()}`)
    const data = await res.json()
    return data.choices?.[0]?.message?.content || ''
  }
}

// ─── Background topic generation (runs after response via waitUntil) ──────────

async function runTopicGeneration({
  db,
  topicId,
  effectiveClientId,
  topicData,
  agencySettings,
  suppressEmail,
  adminSession,
}: {
  db:               ReturnType<typeof createAdminClient>
  topicId:          string
  effectiveClientId: string
  topicData:        TopicData
  agencySettings:   AgencySettings
  suppressEmail:    boolean
  adminSession?:    AdminSession | null
}): Promise<void> {
  const provider = agencySettings.ai_provider || 'anthropic'
  const model    = agencySettings.ai_model    || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o')
  const apiKey   = agencySettings.ai_api_key
  const agency   = agencySettings.agency_name || 'the agency'

  try {
    // ── Load all settings in parallel ────────────────────────────────────────
    const [clientSettingsRes, globalSettingsRes, existingPostsRes, pendingTopicsRes, sitemapPagesRes] = await Promise.all([
      db.from('content_settings')
        .select('business_background, services, target_audience, geographic_focus, brand_voice, post_structure, sitemap_url, sitemap_urls, manual_link_urls, phone_number, target_length, connection_id, cta_list, publish_time, eeat_data, topic_guidelines, content_image_generation, content_image_prompt, blog_url_prefix, vertical')
        .eq('client_id', effectiveClientId)
        .maybeSingle(),
      db.from('content_settings')
        .select('post_structure')
        .is('client_id', null)
        .maybeSingle(),
      db.from('content_posts')
        .select('focus_topic, title, target_keyword')
        .eq('client_id', effectiveClientId)
        .not('status', 'eq', 'rejected')
        .order('generated_at', { ascending: false })
        .limit(100),
      // Load all non-rejected/non-generating topics so concurrent runs can't cannibalize
      db.from('content_topics')
        .select('topic, target_keyword')
        .eq('client_id', effectiveClientId)
        .not('status', 'in', '("rejected","generating")')
        .neq('id', topicData.id),
      db.from('content_sitemap_pages')
        .select('url, is_priority, is_excluded, created_at, source_sitemap')
        .eq('client_id', effectiveClientId),
    ])

    const clientSettings = clientSettingsRes.data as Record<string, unknown> | null
    const globalSettings = globalSettingsRes.data as { post_structure?: string } | null

    // ── Build client context ──────────────────────────────────────────────────
    const contextLines: string[] = []
    if (clientSettings) {
      if (clientSettings.business_background) contextLines.push(`Business background: ${clientSettings.business_background}`)
      if (clientSettings.services)            contextLines.push(`Services offered: ${clientSettings.services}`)
      if (clientSettings.target_audience)     contextLines.push(`Target audience: ${clientSettings.target_audience}`)
      if (clientSettings.geographic_focus)    contextLines.push(`Geographic focus: ${clientSettings.geographic_focus}`)
      if (clientSettings.brand_voice)         contextLines.push(`Brand voice: ${clientSettings.brand_voice}`)
      if (clientSettings.phone_number) {
        const ph     = String(clientSettings.phone_number)
        const digits = ph.replace(/\D/g, '')
        contextLines.push(`REQUIRED: Every time the phone number ${ph} appears in the post HTML, it MUST be wrapped as <a href="tel:${digits}">${ph}</a> — never display it as plain unlinked text.`)
      }
      if (clientSettings.blog_url_prefix) {
        const prefix = String(clientSettings.blog_url_prefix).replace(/\/+$/, '')
        contextLines.push(`Blog URL structure: Blog posts on this site use the path prefix "${prefix}/". All valid blog post URLs are already listed in the "Available site pages" list above — use ONLY those exact URLs. Do NOT construct or infer any blog post URL by combining this prefix with a slug.`)
      }
    }

    const sitemapRows  = (sitemapPagesRes.data ?? []) as { url: string; is_priority: boolean; is_excluded: boolean; created_at: string; source_sitemap: string | null }[]
    const priorityUrls = sitemapRows.filter(r => r.is_priority && isLinkableUrl(r.url)).map(r => r.url)
    const excludedUrls = sitemapRows.filter(r => r.is_excluded).map(r => r.url)
    if (priorityUrls.length > 0) contextLines.push(`\nPriority pages — prefer for internal links when contextually relevant:\n${priorityUrls.join('\n')}`)
    if (excludedUrls.length > 0) contextLines.push(`\nExcluded pages — do NOT link to or reference these:\n${excludedUrls.join('\n')}`)

    // Accumulate every URL we hand to the model — used to strip hallucinated links after generation.
    // Only include linkable HTML pages — excludes XML sitemaps, PHP scripts, feeds, etc.
    const allowedInternalUrls = new Set<string>(
      sitemapRows.filter(r => !r.is_excluded && isLinkableUrl(r.url)).map(r => r.url)
    )

    const sitemapUrls: string[] = (() => {
      const urls = clientSettings?.sitemap_urls
      if (Array.isArray(urls) && urls.length > 0) return urls as string[]
      if (clientSettings?.sitemap_url) return [clientSettings.sitemap_url as string]
      return []
    })()

    const halfMonthAgo1   = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()
    const cacheIsFresh1   = sitemapRows.length > 0 && sitemapRows.some(r => r.created_at >= halfMonthAgo1)
    const topicKws        = topicData.target_keyword ? [topicData.target_keyword] : []
    // Brief's internal_link_targets already identify the best pages — trim sitemap to 30
    const briefHasLinks   = (topicData.seo_brief?.internal_link_targets?.length ?? 0) > 0
    const sitemapPageCap  = briefHasLinks ? 30 : 60

    // Blog post URLs from the sitemap — used for cannibalization prevention below
    let sitemapBlogPostUrls: string[] = []

    if (cacheIsFresh1) {
      const generalPages = sitemapRows
        .filter(r => !r.is_priority && !r.is_excluded && isLinkableUrl(r.url))
        .map(r => ({ url: r.url, score: scoreUrlRelevance(r.url, topicKws) }))
        .sort((a, b) => b.score - a.score)
        .map(r => r.url)
        .slice(0, sitemapPageCap - priorityUrls.length)
      if (generalPages.length > 0)
        contextLines.push(`\nAvailable site pages for internal linking:\n${generalPages.join('\n')}`)

      // Identify existing blog posts from cached sitemap rows.
      // source_sitemap column (set when post-sitemap.xml was explicitly followed)
      // is the primary signal; URL path pattern is the fallback for older cache rows.
      sitemapBlogPostUrls = sitemapRows
        .filter(r => !r.is_excluded && (
          /post|blog|article|news/i.test(r.source_sitemap ?? '') ||
          /\/(blog|news|articles?|posts?)\//.test(r.url)
        ))
        .map(r => r.url)
    } else if (sitemapUrls.length > 0) {
      const sitemapDataArr = await Promise.all(sitemapUrls.map(fetchSitemapData))
      const excluded = new Set(excludedUrls)
      const allPages = sitemapDataArr.flatMap(d => d.pages)
      const scored   = Array.from(new Set(allPages))
        .filter(u => !excluded.has(u))
        .map(u => ({ url: u, score: scoreUrlRelevance(u, topicKws) }))
        .sort((a, b) => b.score - a.score)
        .map(r => r.url)
        .slice(0, sitemapPageCap)
      if (scored.length > 0)
        contextLines.push(`\nAvailable site pages for internal linking:\n${scored.join('\n')}`)
      scored.forEach(u => allowedInternalUrls.add(u))
      // Blog posts from post-specific sub-sitemaps (live fetch)
      sitemapBlogPostUrls = sitemapDataArr.flatMap(d => d.blogPosts).filter(u => !excluded.has(u))
    }

    const clientContext = contextLines.length > 0 ? `Client context:\n${contextLines.join('\n')}\n` : ''

    const existingPosts = (existingPostsRes.data ?? []) as { focus_topic?: string; title?: string; target_keyword?: string | null }[]
    const pendingTopics = (pendingTopicsRes.data ?? []) as { topic?: string; target_keyword?: string | null }[]
    // Derive readable topic labels from existing blog post URLs on the client's site.
    // These are posts that predate our system and won't be in content_posts — including them
    // prevents the AI from writing about topics the client has already published.
    const sitemapBlogEntries = sitemapBlogPostUrls.slice(0, 80).map(url => {
      try {
        const slug = new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''
        if (slug.length < 4) return null
        return `"${slug.replace(/-/g, ' ')}" [existing site post]`
      } catch { return null }
    }).filter(Boolean)
    const avoidEntries = [
      ...existingPosts.map(p => {
        const label = p.focus_topic || p.title || ''
        if (!label) return null
        return p.target_keyword ? `"${label}" (keyword: ${p.target_keyword})` : `"${label}"`
      }),
      ...pendingTopics.map(t => {
        const label = t.topic || ''
        if (!label) return null
        return t.target_keyword ? `"${label}" (keyword: ${t.target_keyword}) [queued]` : `"${label}" [queued]`
      }),
      ...sitemapBlogEntries,
    ].filter(Boolean)
    const avoidList = avoidEntries.join('\n')

    const postStructure = mergePostStructures(
      globalSettings?.post_structure,
      clientSettings?.post_structure as string | undefined
    )

    // ── Master writing prompt — pick per content_type ─────────────────────────
    let masterPreamble: string | null = null
    const contentType = topicData.content_type ?? 'blog'
    const rawMasterPrompt =
      contentType === 'service_page' ? (agencySettings.service_page_master_prompt || agencySettings.master_writing_prompt)
      : contentType === 'regular_page' ? (agencySettings.regular_page_master_prompt || agencySettings.master_writing_prompt)
      : agencySettings.master_writing_prompt
    if (rawMasterPrompt && clientSettings) {
      const { data: cl } = await db.from('clients').select('name').eq('id', effectiveClientId).maybeSingle()
      const clientName = (cl as { name?: string } | null)?.name ?? ''
      const alwaysIncludeLinks = parseManualLinks((clientSettings.manual_link_urls as string[] | null) ?? [])
      const urlsAndAnchors = alwaysIncludeLinks.length > 0
        ? alwaysIncludeLinks.map(l => `${l.url}${l.label ? ` (${l.label})` : ''}`).join('\n')
        : '(none specified — use priority pages and sitemap context below when contextually relevant)'
      masterPreamble = rawMasterPrompt
        .replace(/\[BRAND_NAME\]/g,        clientName)
        .replace(/\[BRAND_DESCRIPTION\]/g, String(clientSettings.business_background ?? ''))
        .replace(/\[TARGET_AUDIENCE\]/g,   String(clientSettings.target_audience ?? ''))
        .replace(/\[AUDIENCE_DETAIL\]/g,   String(clientSettings.target_audience ?? ''))
        .replace(/\[VOICE_NOTES\]/g,       String(clientSettings.brand_voice ?? ''))
        .replace(/\[WORD_COUNT\]/g,        String((clientSettings.target_length as number | null) ?? 1800))
        .replace(/\[PRIMARY_KEYWORD\]/g,   topicData.target_keyword ?? '')
        .replace(/\[WORKING_TITLE\]/g,     topicData.topic ?? '')
        .replace(/\[SECONDARY_KEYWORDS\]/g, topicData.secondary_keywords ?? '(derive LSI terms from topic and primary keyword)')
        .replace(/\[SEARCH_INTENT\]/g,      topicData.search_intent ?? 'informational')
        .replace(/\[informational \| commercial \| transactional \| navigational\]/g, topicData.search_intent ?? 'informational')
        .replace(/\[URLS_AND_ANCHORS\]/g,   urlsAndAnchors)
        .replace(/\[CTA\]/g,                String(clientSettings.cta_list ?? 'Contact us to learn more'))
        .replace(/\[SOURCES\]/g,            'Reference 2–4 credible sources (gov, edu, industry publications) by name in the prose where factually relevant — do NOT insert any hyperlinks to external websites')
        .replace(/\[[A-Z_]+\]/g, '')
    }

    // ── E-E-A-T + content restrictions (appended to system prompt) ───────────
    const eeatFormatted = formatEeat(clientSettings?.eeat_data)
    const eeatSection   = eeatFormatted
      ? `\nE-E-A-T Credibility Signals — weave naturally into the post: ${eeatFormatted}`
      : ''
    const restrictionSection = (clientSettings?.topic_guidelines as string | null | undefined)?.trim()
      ? `\nContent Restrictions (strictly enforced — never violate these):\n${clientSettings!.topic_guidelines}`
      : ''

    const systemPrompt = buildSystemPrompt(agency, clientContext, avoidList, postStructure, masterPreamble, contentType === 'blog' ? `${BLOG_WRITER_INTENT_REMINDER}\n\n${BLOG_STRUCTURE_RULES}` : null,
      buildEditorialStandards({ vertical: (clientSettings?.vertical as string | null) ?? null }))
      + eeatSection + restrictionSection

    // ── Build user prompt ──────────────────────────────────────────────────────
    const targetLength = (clientSettings?.target_length as number | null) ?? 1500
    const [gscLinks, manualLinks] = await Promise.all([
      getGscInternalLinks(db, effectiveClientId, topicData.target_keyword),
      Promise.resolve(parseManualLinks((clientSettings?.manual_link_urls as string[] | null) ?? [])),
    ])
    // Filter GSC entries whose query already maps to a covered keyword to reduce cannibalization signals
    const coveredKeywords = new Set(
      [...existingPosts, ...pendingTopics]
        .map(p => ((p as Record<string, unknown>).target_keyword as string | null)?.toLowerCase().trim())
        .filter(Boolean) as string[]
    )
    const filteredGscLinks = gscLinks.filter(l => {
      const q = l.query.toLowerCase().trim()
      return !Array.from(coveredKeywords).some(kw => q.includes(kw) || kw.includes(q))
    })
    // GSC URLs are NOT added to allowedInternalUrls — they're sourced from indexed pages which
    // may include deleted or never-sitemapped content. If a GSC URL is also in the client's
    // sitemap it's already in allowedInternalUrls from the sitemap_pages query above, so
    // valid GSC link suggestions survive; stale/deleted ones get stripped by stripHallucinatedLinks.
    manualLinks.forEach(l => allowedInternalUrls.add(l.url))

    const internalLinkLines: string[] = []
    if (filteredGscLinks.length > 0) {
      internalLinkLines.push('GSC internal link targets (link destinations ONLY — these URLs are ranking on page 2 and benefit from internal links; do NOT use these query strings as topic or keyword inspiration — topic choice must be your own original research into uncovered opportunities):')
      filteredGscLinks.forEach(l => internalLinkLines.push(`  - ${l.url}  (ranks for: "${l.query}", pos ${l.position})`))
    }
    if (manualLinks.length > 0) {
      internalLinkLines.push('Always-include internal links (must appear in the post):')
      manualLinks.forEach(l => internalLinkLines.push(`  - ${l.url}${l.label ? `  (${l.label})` : ''}`))
    }

    const brief = topicData.seo_brief
    const briefLines: string[] = []
    if (brief) {
      if (brief.h2_outline?.length > 0)
        briefLines.push(`\nRequired H2 structure (follow this outline — expand each section):\n${brief.h2_outline.map((h: string, i: number) => `  ${i + 1}. ${h}`).join('\n')}`)
      if (brief.internal_link_targets?.length > 0) {
        briefLines.push(`\nRequired internal links (must appear in the post with contextually natural anchor text):\n${brief.internal_link_targets.map((u: string) => `  - ${u}`).join('\n')}`)
        // Ensure required brief links are in the allowed set so stripHallucinatedLinks keeps them
        ;(brief.internal_link_targets as string[]).forEach((u: string) => allowedInternalUrls.add(u))
      }
      if (brief.faq_opportunities?.length > 0)
        briefLines.push(`\nInclude a FAQ section addressing these questions:\n${brief.faq_opportunities.map((q: string) => `  - ${q}`).join('\n')}`)
      if (brief.local_seo_angle)   briefLines.push(`\nLocal SEO angle to weave in: ${brief.local_seo_angle}`)
      if (brief.cta_text)          briefLines.push(`\nClosing CTA to use: ${brief.cta_text}`)
      if (brief.unique_angle)      briefLines.push(`\nUnique content angle: ${brief.unique_angle}`)
      if (brief.meta_description)  briefLines.push(`\nTarget meta description (150–160 chars): ${brief.meta_description}`)
      if (brief.schema_type)       briefLines.push(`\nContent schema type: ${brief.schema_type}`)
    }

    // ── Silo context (topical authority entity linking) ───────────────────────
    let siloSection = ''
    if (topicData.silo_id) {
      const { data: silo, error: siloErr } = await db
        .from('content_silos')
        .select('name, hub_page_url, hub_page_title, central_entity, cluster_keywords')
        .eq('id', topicData.silo_id)
        .maybeSingle()
      if (siloErr) console.error('[generate] silo fetch error for topic', topicData.silo_id, ':', siloErr.message)

      // Only inject silo block when we have a real URL to link to
      if (silo?.hub_page_url) {
        // Sibling cluster posts already pushed to WP in this silo
        const { data: siblings } = await db
          .from('content_posts')
          .select('title, published_url, target_keyword')
          .eq('silo_id', topicData.silo_id)
          .in('status', ['for_review', 'approved', 'draft_saved', 'published'])
          .not('published_url', 'is', null)
          .limit(20)

        // Track silo URLs as allowed internal links
        allowedInternalUrls.add(silo.hub_page_url)
        ;(siblings ?? []).forEach((s: { published_url: string | null }) => {
          if (s.published_url) allowedInternalUrls.add(s.published_url)
        })

        const siblingLines = (siblings ?? [])
          .filter((s: { title: string | null; published_url: string | null; target_keyword: string | null }) => s.published_url && s.title)
          .map((s: { title: string | null; published_url: string | null; target_keyword: string | null }) =>
            `  - "${s.title}" at ${s.published_url} — covers: ${s.target_keyword ?? 'n/a'}`)
          .join('\n')

        // Uncovered cluster keywords — mention or link where contextually natural
        type ClusterKw = { keyword: string; status: string }
        const uncoveredKws = ((silo.cluster_keywords ?? []) as ClusterKw[])
          .filter(k => k.status === 'planned')
          .map(k => `"${String(k.keyword ?? '').replace(/[\r\n"\\]/g, ' ').trim().slice(0, 120)}"`)
          .filter(k => k.length > 2)
          .slice(0, 8)

        const crossClusterSection = uncoveredKws.length > 0
          ? `\nUncovered cluster topics in this silo (mention or link where contextually natural — these are future pages that will exist):\n${uncoveredKws.map(k => `  - ${k}`).join('\n')}`
          : ''

        siloSection = `
TOPICAL SILO — INTERNAL LINKING STRATEGY:

Hub page (MUST include as an internal link in the first or second body section):
  Title: "${silo.hub_page_title ?? silo.name}"
  URL: ${silo.hub_page_url}
  Anchor text: use the central entity name or a specific descriptive phrase — NOT "click here" or "learn more"
  Central entity: ${silo.central_entity ?? silo.name}
${siblingLines ? `\nPublished cluster articles in this silo (link to 1–3 where this article shares a named entity, concept, or step — reason about semantic relevance, not just proximity):\n${siblingLines}` : ''}${crossClusterSection}
LINKING RULES:
- Link to the hub page once (mandatory).
- Cross-link to sibling articles ONLY when the reader of THIS article would genuinely benefit from reading THAT one — shared entity, shared step, natural "next question."
- Anchor text must name the specific entity or topic: "[service] in [city]", "[problem] cost guide", "[topic] explained", etc. Never generic: "click here", "read more", "this article."
- GSC suggestions below are supplementary; silo hub + entity-reasoned sibling links take priority.`
      }
    }

    // ── Optimization brief injection ─────────────────────────────────────────
    // If an optimization brief exists for this topic, inject its guidelines.
    // Falls back to seo_brief behaviour if no optimization brief found.
    if (topicData.silo_id) {
      const { data: optBrief } = await db
        .from('content_optimization_briefs')
        .select('*')
        .eq('content_topic_id', topicId)
        .maybeSingle()
        .then(r => r.data
          ? r
          : db.from('content_optimization_briefs')
              .select('*')
              .eq('silo_id', topicData.silo_id!)
              .maybeSingle()
        )
      if (optBrief) {
        briefLines.push('\n' + formatBriefForPrompt(optBrief as OptimizationBrief))
      }
    }

    // ── Competitor gap analysis ───────────────────────────────────────────────
    // Prefer the research captured at topic-generation time; if none was stored
    // (manually-added or older topics), run a live SERP gap analysis at write time
    // when a serp_api_key is configured. Every generated post competes on coverage.
    // Provider chain in priority order: DataForSEO (if the client is connected → PAA +
    // AI-Overview intelligence) → topic-time stored SerpAPI research → live SerpAPI → GSC.
    // This runs in the background (waitUntil), so the DataForSEO/scrape calls self-limit via
    // their own fetch timeouts — no withDeadline (which would abandon and still bill a call).
    // Skip the live SerpAPI tier if topic-time research already ran.
    const serpAlreadyTried = topicData.competitors_researched != null
    const competitorGapSection = await gatherCompetitorGap({
      db, clientId: effectiveClientId, keyword: topicData.target_keyword,
      serpApiKey: serpAlreadyTried ? null : agencySettings.serp_api_key,
      storedResearch: topicData.competitors_researched,
    })

    // ── Editor direction notes ────────────────────────────────────────────────
    const editNotesSection = topicData.edit_notes?.trim()
      ? `\nEditor Direction Notes (follow these closely for this specific post):\n${topicData.edit_notes.slice(0, 2000)}`
      : ''

    // ── Search intent writing instructions ───────────────────────────────────
    const intentMap: Record<string, string> = {
      informational:  'Educate thoroughly. Use clear H2/H3 structure, a summary box, FAQ section, and actionable takeaways.',
      commercial:     'Help readers evaluate and choose. Include comparisons, pros/cons table, and a clear recommendation.',
      local_service:  'Target local searchers. Include city/region references, local trust signals, and a contact/map CTA.',
      comparison:     'Structure around head-to-head comparison. Use a comparison table and verdict section.',
      cost_pricing:   'Address cost directly. Include price ranges, factors affecting cost, and value context.',
      how_to:         'Step-by-step structure. Use numbered steps, tips per step, tools/materials list, and a summary.',
      faq:            'Question-answer format. Group related questions, answer concisely, add a summary FAQ schema.',
      emergency:      'Lead with urgency. Put contact info and steps first. Use direct language, avoid filler.',
    }
    const intentSection = topicData.search_intent && intentMap[topicData.search_intent]
      ? `\nSearch Intent: ${topicData.search_intent} — ${intentMap[topicData.search_intent]}`
      : ''

    const writingRulesReminder = masterPreamble
      ? '\n\nBEFORE WRITING — mandatory checklist (non-negotiable):\n' +
        '• Zero em dashes (—) or en dashes (–) anywhere in the output\n' +
        '• Zero banned words: delve, tapestry, navigate, landscape, realm, journey, embark, unleash, unlock, dive into, leverage, robust, seamless, foster, harness, cutting-edge, game-changer, revolutionize, paradigm, ever-evolving, "in today\'s fast-paced world", "it\'s important to note", "when it comes to", "in the world of"\n' +
        '• No sentence starts with: Moreover, Furthermore, Additionally, In conclusion\n' +
        '• Every phone number in the post MUST be a tel: hyperlink — no plain text phone numbers\n' +
        '• Open with a concrete hook (stat, scenario, contrarian claim) — never a generic intro\n' +
        '• Confirm compliance before finalising output'
      : ''

    const contentTypeLabel =
      contentType === 'service_page' ? 'service page'
      : contentType === 'regular_page' ? 'page'
      : 'blog post'
    const userPrompt = `Write a detailed, SEO-optimized ${contentTypeLabel} on the following topic:

Title: ${topicData.topic}
Target keyword: ${topicData.target_keyword || 'derive from topic'}
${topicData.rationale ? `Topic rationale: ${topicData.rationale}` : ''}
${contentType === 'regular_page' && topicData.custom_focus ? `Page focus: ${topicData.custom_focus}` : ''}
${topicData.page_to_support ? `Core page to support (must appear as an internal link): ${topicData.page_to_support}` : ''}
${siloSection}
${internalLinkLines.length > 0 ? '\n' + internalLinkLines.join('\n') : ''}
${briefLines.length > 0 ? briefLines.join('\n') : ''}
${competitorGapSection}
${editNotesSection}
${intentSection}

Target approximately ${brief?.word_count_target ?? targetLength} words.${writingRulesReminder}`

    // ── Generate ──────────────────────────────────────────────────────────────
    let rawText: string
    try {
      rawText = await callAI(provider, model, apiKey, systemPrompt, userPrompt)
    } catch (err) {
      console.error('[generate] AI call failed for topic', topicId, err)
      await db.from('content_topics')
        .update({ status: 'approved', generation_error: String(err) })
        .eq('id', topicId)
      return
    }

    const parsed = parseResponse(rawText)

    // Strip any internal links the model invented that aren't in the provided sitemap
    parsed.content = stripHallucinatedLinks(parsed.content, allowedInternalUrls)
    // Sanitize dangerous tags the model should never generate but occasionally does
    parsed.content = stripDangerousHtml(parsed.content)
    // Remove duplicate H1 from body (CMS renders title field as the page H1)
    parsed.content = stripH1FromContent(parsed.content)
    // Remove links with generic filler anchor text ("click here", "learn more", etc.)
    parsed.content = stripGenericAnchorText(parsed.content)
    parsed.content = styleTables(parsed.content)

    // ── Minimum quality gate ──────────────────────────────────────────────────
    // Word count must be computed BEFORE FAQ schema injection so the JSON
    // text inside the script block doesn't inflate the count.
    const wc0 = computeWordCount(parsed.content)
    if (!parsed.title.trim() || wc0 < 150) {
      console.error('[generate] generation failed quality gate — title empty or content too short:', { wc: wc0, title: parsed.title, topicId })
      await db.from('content_topics')
        .update({ status: 'approved', generation_error: 'AI returned empty or too-short content — please regenerate' })
        .eq('id', topicId)
      return
    }

    // Inject FAQ JSON-LD schema after quality gate so script text doesn't inflate wc0
    parsed.content = injectFaqSchema(parsed.content)

    // ── Save post ──────────────────────────────────────────────────────────────
    let connectionId = (clientSettings?.connection_id as string | null) ?? null
    if (!connectionId) {
      const { data: fallbackConn } = await db
        .from('client_connections')
        .select('id, connector:connectors!inner(type)')
        .eq('client_id', effectiveClientId)
        .eq('status', 'active')
        .in('connector.type', ['wordpress', 'bigcommerce'])
        .limit(1)
        .maybeSingle()
      connectionId = (fallbackConn as { id: string } | null)?.id ?? null
    }

    const wc        = wc0  // already computed by quality gate above
    // custom_slug from wizard takes precedence; otherwise use AI-generated slug → title fallback
    const finalSlug = await uniqueSlug(db, effectiveClientId, topicData.custom_slug || parsed.slug || titleToSlug(parsed.title))
    const seoScore = scoreSeoPost({
      html:         parsed.content,
      title:        parsed.title,
      metaDesc:     parsed.metaDescription || null,
      slug:         finalSlug,
      wordCount:    wc,
      targetLength: (clientSettings?.target_length as number | null) ?? 1500,
      brief,
    })

    // Pre-publish quality gate. Compares against the client's own published posts,
    // so it can see the corpus-level "every page has the same skeleton" pattern
    // that no single-document check would catch. Never blocks a human; a critical
    // finding only holds the post back from the unattended cron push.
    const { data: qgSiblings } = await db
      .from('content_posts')
      .select('id, title, content')
      .eq('client_id', effectiveClientId)
      .eq('content_type', topicData.content_type ?? 'blog')
      .in('status', ['draft_saved', 'published'])
      .order('generated_at', { ascending: false })
      .limit(20)

    const quality = runQualityGate({
      html:          parsed.content,
      title:         parsed.title,
      targetKeyword: topicData.target_keyword ?? null,
      slug:          finalSlug,
      // The client's real site URLs, so the gate can catch a post that duplicates
      // a page the generator never knew about. sitemapRows is empty exactly when
      // the sitemap failed to parse — which is when this backstop matters most,
      // and the gate raises its own finding for that case.
      siteUrls:      sitemapRows.map(r => r.url),
      siblings:      (qgSiblings ?? []) as { id: string; title: string | null; content: string | null }[],
      regulated:     isRegulatedVertical(clientSettings?.vertical),
    })

    const { data: savedPost, error: insertError } = await db.from('content_posts').insert({
      client_id:           effectiveClientId,
      connection_id:       connectionId,
      status:              'for_review',
      title:               parsed.title,
      seo_title:           parsed.seoTitle || parsed.title,
      content:             parsed.content,
      meta_description:    parsed.metaDescription,
      slug:                finalSlug,
      quality_report:      quality,
      quality_score:       quality.score,
      quality_checked_at:  new Date().toISOString(),
      target_keyword:      parsed.focusKeyword,
      focus_topic:         topicData.topic ?? null,
      topic_rationale:     topicData.rationale ?? null,
      suggested_tags:      parsed.suggestedTags,
      word_count:          wc,
      heading_count:       computeHeadingCount(parsed.content),
      internal_links:      computeInternalLinks(parsed.content),
      generated_by:        'topic',
      ai_model:            model,
      prompt_used:         userPrompt,
      // Clamp publish date to today if topic's date is in the past or unset; without
      // this a topic created months ago would produce a post with a stale date that
      // falls outside the monthly review window and is never surfaced to admins.
      target_publish_date: (() => {
        const today = new Date().toISOString().slice(0, 10)
        return (topicData.target_publish_date && topicData.target_publish_date >= today)
          ? topicData.target_publish_date
          : today
      })(),
      seo_score:           seoScore,
      schema_type:         brief?.schema_type ?? null,
      excerpt:             parsed.metaDescription || null,
      content_type:        topicData.content_type ?? 'blog',
      ...(topicData.custom_focus ? { custom_focus: topicData.custom_focus } : {}),
      // Only include silo_id when set — column requires migration 149 (content_silos)
      ...(topicData.silo_id ? { silo_id: topicData.silo_id } : {}),
    }).select('id').maybeSingle()

    if (insertError || !savedPost) {
      console.error('[generate] DB insert failed for topic', topicId, insertError)
      await db.from('content_topics')
        .update({ status: 'approved', generation_error: `DB error: ${insertError?.message ?? 'Unknown'}` })
        .eq('id', topicId)
      return
    }

    // Link post back to topic
    await db.from('content_topics')
      .update({ post_id: savedPost.id, status: 'generated', generation_error: null })
      .eq('id', topicId)

    // Carry silo-keyword provenance through to the post, so the silo can show
    // "this keyword produced this article" and the article can show where it
    // came from. Soft-fails if migration 201 has not been applied yet.
    await attachPostToKeyword(db, topicId, savedPost.id).catch(() => {})

    // Register the target keyword in the SEO datastream (content → keyword link), so
    // once DataForSEO is connected, rank checks surface on this post's card and editor.
    // Soft-fails if the seo_keywords table isn't present yet (migration 189 pending).
    if (parsed.focusKeyword) {
      await registerKeyword({
        clientId:      effectiveClientId,
        keyword:       parsed.focusKeyword,
        source:        'topic',
        contentPostId: savedPost.id,
        intent:        topicData.search_intent ?? null,
      })
    }

    logActivity(adminSession ?? null, 'generated', 'post', {
      resourceId: savedPost.id,
      clientId:   effectiveClientId,
      meta:       { topic: topicData.topic, title: parsed.title, model },
    })

    // Auto-generate featured image in background if enabled and key is configured
    const imageEnabled = (clientSettings as Record<string, unknown> | null)?.content_image_generation === true
    const imagePromptOverride = (clientSettings as Record<string, unknown> | null)?.content_image_prompt as string | undefined
    if (imageEnabled && (agencySettings.openai_api_key || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY)) {
      waitUntil(
        generatePostImage(db, savedPost.id, agencySettings.openai_api_key, imagePromptOverride).catch(() => {})
      )
    }

    // Email + Discord notification
    if (!suppressEmail) {
      const agencyName = agencySettings.agency_name || 'Agency Dashboard'
      const appUrl     = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
      const dateLabel  = topicData.target_publish_date ? ` — publishes ${topicData.target_publish_date}` : ''

      let clientName = ''
      let discordChannelId: string | null = null
      try {
        const { data: cl } = await db.from('clients').select('name, discord_channel_id').eq('id', effectiveClientId).maybeSingle()
        clientName = (cl as { name?: string } | null)?.name ?? ''
        discordChannelId = (cl as { discord_channel_id?: string | null } | null)?.discord_channel_id ?? null
      } catch {}

      const notifConfig = ((agencySettings as Record<string, unknown>).notification_config as NotifConfig | null) ?? {}
      if (agencySettings.notification_email && getNotif(notifConfig, 'content_post_generated').email) {
        try {
          await sendEmail({
            to:      agencySettings.notification_email,
            subject: `[${agencyName}] Post ready for review: ${parsed.title}`,
            html: `<p>A new post has been generated for <strong>${clientName || 'a client'}</strong> and is ready for review: <strong>${parsed.title}</strong>${dateLabel}.</p>
                   <p><a href="${appUrl}/admin/clients/${effectiveClientId}?tab=content&amp;subtab=schedule">Review Post →</a></p>`,
          })
        } catch (emailErr) {
          console.error('[generate] email error:', emailErr)
        }
      }

      if (agencySettings.discord_bot_token && discordChannelId && getNotif(notifConfig, 'content_post_generated').client) {
        void sendDiscordMessage(
          agencySettings.discord_bot_token,
          discordChannelId,
          `✍️ Post ready for review: **${parsed.title}**${clientName ? ` (${clientName})` : ''}${dateLabel}`
        ).catch(() => {})
      }
    }

  } catch (outerErr) {
    console.error('[generate] runTopicGeneration failed for topic', topicId, outerErr)
    try {
      await db.from('content_topics')
        .update({ status: 'approved', generation_error: String(outerErr) })
        .eq('id', topicId)
    } catch { /* ignore */ }
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const adminSession = await getAdminSession()

  const body = await parseBody<{
    prompt?:              string
    client_id?:           string
    topic_id?:            string
    suppress_email?:      boolean
    target_publish_date?: string   // manual "pick a day" flow
    content_type?:        string   // manual flow — defaults to 'blog'
  }>(request)
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  const { prompt, client_id, topic_id, suppress_email, target_publish_date, content_type } = body
  const manualContentType = content_type ?? 'blog'

  if (!prompt && !topic_id) {
    return NextResponse.json({ error: 'Missing prompt or topic_id' }, { status: 400 })
  }

  const db = createAdminClient()

  // ── Load agency settings ─────────────────────────────────────────────────
  const { data: agencySettings, error: agErr } = await db
    .from('agency_settings')
    .select('ai_provider, ai_model, ai_api_key, openai_api_key, agency_name, notification_email, notify_post_generated, notify_post_uploaded, master_writing_prompt, service_page_master_prompt, regular_page_master_prompt, discord_bot_token, serp_api_key, notification_config')
    .limit(1)
    .maybeSingle()

  if (agErr) {
    console.error('[generate] agency_settings load failed:', agErr)
    return NextResponse.json({ error: 'Settings load error — please retry in a moment' }, { status: 500 })
  }
  if (!agencySettings?.ai_api_key) {
    const provider = (agencySettings as Record<string, unknown> | null)?.ai_provider ?? 'anthropic'
    console.error('[generate] ai_api_key is null/empty. Row exists:', !!agencySettings, 'provider:', provider, 'openai_key_set:', !!agencySettings?.openai_api_key)
    return NextResponse.json({
      error: `AI not configured. The "${provider}" API key (ai_api_key) is missing in Agency Settings. Note: the image key (openai_api_key) is separate and does not power content generation.`,
    }, { status: 400 })
  }

  // ── Topic-based path — fire-and-forget with waitUntil ─────────────────────
  if (topic_id) {
    const { data: topic, error: topicErr } = await db
      .from('content_topics')
      .select('id, topic, rationale, target_keyword, page_to_support, client_id, target_publish_date, search_intent, secondary_keywords, seo_brief, competitors_researched, edit_notes, content_type, custom_focus, silo_id, custom_slug')
      .eq('id', topic_id)
      .maybeSingle()
    if (topicErr || !topic) {
      console.error('[generate] topic lookup failed:', topicErr ?? 'no row', 'topic_id:', topic_id)
      return NextResponse.json({ error: 'Topic not found' }, { status: 404 })
    }

    // Idempotency guard
    const { data: existing } = await db.from('content_topics').select('post_id').eq('id', topic_id).maybeSingle()
    if ((existing as { post_id: string | null } | null)?.post_id) {
      return NextResponse.json({ ok: true, postId: (existing as { post_id: string }).post_id, skipped: true })
    }

    // Mark as generating so UI updates immediately
    await db.from('content_topics').update({ status: 'generating' }).eq('id', topic_id)

    // Run generation in background — Vercel keeps function alive past response
    waitUntil(runTopicGeneration({
      db,
      topicId:          topic_id,
      effectiveClientId: (topic as unknown as { client_id: string }).client_id,
      topicData:        topic as unknown as TopicData,
      agencySettings:   agencySettings as unknown as AgencySettings,
      suppressEmail:    !!suppress_email,
      adminSession,
    }))

    return NextResponse.json({ ok: true, queued: true })
  }

  // ── Manual prompt-based path — synchronous (ContentEditor needs the response) ──
  const provider         = (agencySettings.ai_provider as string | null) || 'anthropic'
  const model            = (agencySettings.ai_model    as string | null) || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o')
  const apiKey           = agencySettings.ai_api_key as string
  const agency           = (agencySettings.agency_name as string | null) || 'the agency'
  const effectiveClientId = client_id ?? null

  const [clientSettingsRes, globalSettingsRes, existingPostsRes, pendingTopicsRes2, sitemapPagesRes] = await Promise.all([
    effectiveClientId
      ? db.from('content_settings')
          .select('business_background, services, target_audience, geographic_focus, brand_voice, post_structure, sitemap_url, sitemap_urls, manual_link_urls, phone_number, target_length, connection_id, cta_list, publish_time, eeat_data, topic_guidelines, blog_url_prefix, content_image_generation, content_image_prompt, vertical')
          .eq('client_id', effectiveClientId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('content_settings')
      .select('post_structure')
      .is('client_id', null)
      .maybeSingle(),
    effectiveClientId
      ? db.from('content_posts')
          .select('focus_topic, title, target_keyword')
          .eq('client_id', effectiveClientId)
          .not('status', 'eq', 'rejected')
          .order('generated_at', { ascending: false })
          .limit(100)
      : Promise.resolve({ data: null }),
    effectiveClientId
      ? db.from('content_topics')
          .select('topic, target_keyword')
          .eq('client_id', effectiveClientId)
          .not('status', 'eq', 'rejected')
      : Promise.resolve({ data: null }),
    effectiveClientId
      ? db.from('content_sitemap_pages')
          .select('url, is_priority, is_excluded, created_at')
          .eq('client_id', effectiveClientId)
      : Promise.resolve({ data: null }),
  ])

  const clientSettings = clientSettingsRes.data as Record<string, unknown> | null
  const globalSettings = globalSettingsRes.data as { post_structure?: string } | null

  const contextLines: string[] = []
  if (clientSettings) {
    if (clientSettings.business_background) contextLines.push(`Business background: ${clientSettings.business_background}`)
    if (clientSettings.services)            contextLines.push(`Services offered: ${clientSettings.services}`)
    if (clientSettings.target_audience)     contextLines.push(`Target audience: ${clientSettings.target_audience}`)
    if (clientSettings.geographic_focus)    contextLines.push(`Geographic focus: ${clientSettings.geographic_focus}`)
    if (clientSettings.brand_voice)         contextLines.push(`Brand voice: ${clientSettings.brand_voice}`)
    if (clientSettings.phone_number) {
      const ph     = String(clientSettings.phone_number)
      const digits = ph.replace(/\D/g, '')
      contextLines.push(`REQUIRED: Every time the phone number ${ph} appears in the post HTML, it MUST be wrapped as <a href="tel:${digits}">${ph}</a> — never display it as plain unlinked text.`)
    }
    if (clientSettings.blog_url_prefix) {
      const prefix = String(clientSettings.blog_url_prefix).replace(/\/+$/, '')
      contextLines.push(`Blog URL structure: Blog posts on this site use the path prefix "${prefix}/". All valid blog post URLs are already listed in the "Available site pages" list above — use ONLY those exact URLs. Do NOT construct or infer any blog post URL by combining this prefix with a slug.`)
    }
  }

  const sitemapRows  = (sitemapPagesRes.data ?? []) as { url: string; is_priority: boolean; is_excluded: boolean; created_at: string }[]
  const priorityUrls = sitemapRows.filter(r => r.is_priority && isLinkableUrl(r.url)).map(r => r.url)
  const excludedUrls = sitemapRows.filter(r => r.is_excluded).map(r => r.url)
  if (priorityUrls.length > 0) contextLines.push(`\nPriority pages — prefer for internal links when contextually relevant:\n${priorityUrls.join('\n')}`)
  if (excludedUrls.length > 0) contextLines.push(`\nExcluded pages — do NOT link to or reference these:\n${excludedUrls.join('\n')}`)

  // Seed the allowed set from DB-cached sitemap pages — only linkable HTML pages (excludes sitemaps, XML, feeds)
  const manualAllowedUrls = new Set<string>(sitemapRows.filter(r => !r.is_excluded && isLinkableUrl(r.url)).map(r => r.url))

  const sitemapUrls: string[] = (() => {
    const urls = clientSettings?.sitemap_urls
    if (Array.isArray(urls) && urls.length > 0) return urls as string[]
    if (clientSettings?.sitemap_url) return [clientSettings.sitemap_url as string]
    return []
  })()

  const halfMonthAgo2 = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()
  const cacheIsFresh2 = sitemapRows.length > 0 && sitemapRows.some(r => r.created_at >= halfMonthAgo2)

  if (cacheIsFresh2) {
    const generalPages = sitemapRows
      .filter(r => !r.is_priority && !r.is_excluded && isLinkableUrl(r.url))
      .map(r => ({ url: r.url, score: scoreUrlRelevance(r.url, []) }))
      .sort((a, b) => b.score - a.score)
      .map(r => r.url)
      .slice(0, 60 - priorityUrls.length)
    if (generalPages.length > 0)
      contextLines.push(`\nAvailable site pages for internal linking:\n${generalPages.join('\n')}`)
  } else if (sitemapUrls.length > 0) {
    const allPages = (await Promise.all(sitemapUrls.map(fetchSitemapPages))).flat()
    const excluded = new Set(excludedUrls)
    const unique   = Array.from(new Set(allPages)).filter(u => !excluded.has(u)).slice(0, 60)
    if (unique.length > 0) contextLines.push(`\nAvailable site pages for internal linking:\n${unique.join('\n')}`)
    unique.forEach(u => manualAllowedUrls.add(u))
  }

  // Seed manual link URLs so links the AI correctly generates to them aren't stripped
  parseManualLinks((clientSettings?.manual_link_urls as string[] | null) ?? [])
    .forEach(l => manualAllowedUrls.add(l.url))

  const clientContext = contextLines.length > 0 ? `Client context:\n${contextLines.join('\n')}\n` : ''

  const existingPosts2   = (existingPostsRes.data  ?? []) as { focus_topic?: string; title?: string; target_keyword?: string | null }[]
  const pendingTopics2   = (pendingTopicsRes2.data  ?? []) as { topic?: string; target_keyword?: string | null }[]
  const avoidList = [
    ...existingPosts2.map(p => {
      const label = p.focus_topic || p.title || ''
      if (!label) return null
      return p.target_keyword ? `"${label}" (keyword: ${p.target_keyword})` : `"${label}"`
    }),
    ...pendingTopics2.map(t => {
      const label = t.topic || ''
      if (!label) return null
      return t.target_keyword ? `"${label}" (keyword: ${t.target_keyword}) [queued]` : `"${label}" [queued]`
    }),
  ].filter(Boolean).join('\n')

  const postStructure = mergePostStructures(
    globalSettings?.post_structure,
    clientSettings?.post_structure as string | undefined
  )

  // Master writing prompt for manual path (topic-specific vars will be empty)
  let masterPreamble: string | null = null
  const rawMasterPrompt = (agencySettings as Record<string, unknown>).master_writing_prompt as string | null
  if (rawMasterPrompt && clientSettings && effectiveClientId) {
    const { data: cl } = await db.from('clients').select('name').eq('id', effectiveClientId).maybeSingle()
    const clientName = (cl as { name?: string } | null)?.name ?? ''
    const alwaysIncludeLinks = parseManualLinks((clientSettings.manual_link_urls as string[] | null) ?? [])
    const urlsAndAnchors = alwaysIncludeLinks.length > 0
      ? alwaysIncludeLinks.map(l => `${l.url}${l.label ? ` (${l.label})` : ''}`).join('\n')
      : '(none specified — use priority pages and sitemap context below when contextually relevant)'
    masterPreamble = rawMasterPrompt
      .replace(/\[BRAND_NAME\]/g,        clientName)
      .replace(/\[BRAND_DESCRIPTION\]/g, String(clientSettings.business_background ?? ''))
      .replace(/\[TARGET_AUDIENCE\]/g,   String(clientSettings.target_audience ?? ''))
      .replace(/\[AUDIENCE_DETAIL\]/g,   String(clientSettings.target_audience ?? ''))
      .replace(/\[VOICE_NOTES\]/g,       String(clientSettings.brand_voice ?? ''))
      .replace(/\[WORD_COUNT\]/g,        String((clientSettings.target_length as number | null) ?? 1800))
      .replace(/\[PRIMARY_KEYWORD\]/g,   '')
      .replace(/\[WORKING_TITLE\]/g,     '')
      .replace(/\[SECONDARY_KEYWORDS\]/g, '(derive LSI terms from topic and primary keyword)')
      .replace(/\[SEARCH_INTENT\]/g,     'informational')
      .replace(/\[informational \| commercial \| transactional \| navigational\]/g, 'informational')
      .replace(/\[URLS_AND_ANCHORS\]/g,   urlsAndAnchors)
      .replace(/\[CTA\]/g,                String(clientSettings.cta_list ?? 'Contact us to learn more'))
      .replace(/\[SOURCES\]/g,            'Reference 2–4 credible sources (gov, edu, industry publications) by name in the prose where factually relevant — do NOT insert any hyperlinks to external websites')
      .replace(/\[[A-Z_]+\]/g, '')
  }

  const manualEeatFormatted = formatEeat(clientSettings?.eeat_data)
  const manualEeatSection   = manualEeatFormatted
    ? `\nE-E-A-T Credibility Signals — weave naturally into the post: ${manualEeatFormatted}`
    : ''
  const manualRestrictionSection = (clientSettings?.topic_guidelines as string | null | undefined)?.trim()
    ? `\nContent Restrictions (strictly enforced — never violate these):\n${clientSettings!.topic_guidelines}`
    : ''

  // Live competitor-gap analysis for the manual path. Use a concise seed from the
  // prompt (a full instruction makes a poor SERP query) and only when it reads
  // keyword-like. Soft-fails to '' with no serp_api_key or on error.
  // Manual path is synchronous (the editor waits), so bound the DataForSEO SERP call via
  // serpTimeoutMs — NOT an outer deadline race, which would abandon the result while the
  // paid call still completes and bills (the scrape/SerpAPI tiers self-bound already).
  const manualSeed = extractManualSeed(prompt)
  const manualCompetitorSection = looksKeywordLike(manualSeed)
    ? await gatherCompetitorGap({ db, clientId: effectiveClientId ?? '', keyword: manualSeed, serpApiKey: agencySettings.serp_api_key, serpTimeoutMs: 8000 })
    : ''

  const systemPrompt = buildSystemPrompt(agency, clientContext, avoidList, postStructure, masterPreamble, manualContentType === 'blog' ? `${BLOG_WRITER_INTENT_REMINDER}\n\n${BLOG_STRUCTURE_RULES}` : null,
    buildEditorialStandards({ vertical: (clientSettings?.vertical as string | null) ?? null }))
    + manualEeatSection + manualRestrictionSection + manualCompetitorSection

  let rawText: string
  try {
    rawText = await callAI(provider, model, apiKey, systemPrompt, prompt!)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }

  const parsed = parseResponse(rawText)
  parsed.content = stripHallucinatedLinks(parsed.content, manualAllowedUrls)
  parsed.content = stripDangerousHtml(parsed.content)
  parsed.content = stripH1FromContent(parsed.content)
  parsed.content = stripGenericAnchorText(parsed.content)
  parsed.content = styleTables(parsed.content)

  // ── Minimum quality gate ────────────────────────────────────────────────────
  // Word count before FAQ schema injection to avoid counting JSON text as words.
  const wc0 = computeWordCount(parsed.content)
  if (!parsed.title.trim() || wc0 < 150) {
    return NextResponse.json(
      { error: 'AI returned empty or too-short content — please try again' },
      { status: 422 }
    )
  }

  // Inject FAQ JSON-LD schema after quality gate
  parsed.content = injectFaqSchema(parsed.content)

  let postId: string | null = null
  if (effectiveClientId) {
    let connectionId = (clientSettings?.connection_id as string | null) ?? null
    if (!connectionId) {
      const { data: fallbackConn } = await db
        .from('client_connections')
        .select('id, connector:connectors!inner(type)')
        .eq('client_id', effectiveClientId)
        .eq('status', 'active')
        .in('connector.type', ['wordpress', 'bigcommerce'])
        .limit(1)
        .maybeSingle()
      connectionId = (fallbackConn as { id: string } | null)?.id ?? null
    }
    const wc        = computeWordCount(parsed.content)
    const finalSlug = await uniqueSlug(db, effectiveClientId, parsed.slug || titleToSlug(parsed.title))
    const seoScore = scoreSeoPost({
      html:         parsed.content,
      title:        parsed.title,
      metaDesc:     parsed.metaDescription || null,
      slug:         finalSlug,
      wordCount:    wc,
      targetLength: (clientSettings?.target_length as number | null) ?? 1500,
      brief:        null,
    })
    // Clamp the requested date to today-or-later so a manual post lands on the
    // calendar/review exactly like an automated one (matches Path A's clamp).
    const manualToday = new Date().toISOString().slice(0, 10)
    const manualPublishDate = target_publish_date && target_publish_date >= manualToday
      ? target_publish_date
      : manualToday
    const { data: savedPost, error: insertError } = await db.from('content_posts').insert({
      client_id:           effectiveClientId,
      connection_id:       connectionId,
      status:              'for_review',
      content_type:        manualContentType,
      target_publish_date: manualPublishDate,
      title:               parsed.title,
      seo_title:           parsed.seoTitle || parsed.title,
      content:             parsed.content,
      meta_description:    parsed.metaDescription,
      slug:                finalSlug,
      target_keyword:      parsed.focusKeyword,
      focus_topic:         null,
      topic_rationale:     null,
      suggested_tags:      parsed.suggestedTags,
      word_count:          wc,
      heading_count:       computeHeadingCount(parsed.content),
      internal_links:      computeInternalLinks(parsed.content),
      generated_by:        'manual',
      ai_model:            model,
      prompt_used:         prompt ?? '',
      seo_score:           seoScore,
      schema_type:         null,
      excerpt:             parsed.metaDescription || null,
    }).select('id').maybeSingle()
    if (insertError) {
      return NextResponse.json({ error: `Failed to save post: ${insertError.message}` }, { status: 500 })
    }
    postId = savedPost?.id ?? null

    // Register the target keyword in the SEO datastream (see Path A). Soft-fails if
    // seo_keywords isn't present yet (migration 189 pending).
    if (postId && parsed.focusKeyword) {
      await registerKeyword({
        clientId:      effectiveClientId,
        keyword:       parsed.focusKeyword,
        source:        'manual',
        contentPostId: postId,
      })
    }

    // Auto-generate featured image in background
    // Match old behavior: generate unless explicitly disabled (null = not set = generate)
    const manualImageEnabled        = (clientSettings as Record<string, unknown> | null)?.content_image_generation !== false
    const manualImagePromptOverride = (clientSettings as Record<string, unknown> | null)?.content_image_prompt as string | undefined
    if (manualImageEnabled && postId && (agencySettings.openai_api_key || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY)) {
      waitUntil(
        generatePostImage(db, postId, agencySettings.openai_api_key, manualImagePromptOverride).catch(() => {})
      )
    }
  }

  return NextResponse.json({ ...parsed, post_id: postId })
}
