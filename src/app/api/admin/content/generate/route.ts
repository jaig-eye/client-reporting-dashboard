import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import { parseBody } from '@/lib/apiError'
import { sendEmail } from '@/lib/email'
import { sendDiscordMessage } from '@/lib/discord'
import { scoreSeoPost } from '@/lib/content/scoreSeoPost'
import { generatePostImage } from '@/lib/content/generatePostImage'
import { formatBriefForPrompt } from '@/lib/content/siloEngine'
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
}

type AgencySettings = {
  ai_provider:           string | null
  ai_model:              string | null
  ai_api_key:            string
  openai_api_key:        string | null
  agency_name:           string | null
  notification_email:    string | null
  notify_post_generated: boolean | null
  notify_post_uploaded:  boolean | null
  master_writing_prompt: string | null
  discord_bot_token:     string | null
}

// ─── Sitemap fetching ─────────────────────────────────────────────────────────

async function fetchSitemapPages(sitemapUrl: string): Promise<string[]> {
  try {
    const res = await fetch(sitemapUrl, {
      signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOBot/1.0)' },
    })
    if (!res.ok) return []
    const xml = await res.text()
    const matches = Array.from(xml.matchAll(/<loc>\s*(https?:\/\/[^\s<]+)\s*<\/loc>/gi))
    return matches
      .map(m => m[1].trim())
      .filter(url => !url.endsWith('.xml'))
      .slice(0, 40)
  } catch {
    return []
  }
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
  if (r.years_in_business)      parts.push(`${r.years_in_business} years in business`)
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
          content:         sanitizeEmDashes(String(parsed.content         || rawText)),
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
  const content = sanitizeEmDashes(extractStr('content') || rawText)
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

// ─── System prompt ────────────────────────────────────────────────────────────

// Pull the NON-NEGOTIABLE RULES section out of the master prompt so we can
// re-append it at the very end — recency bias means the model is far more
// likely to honour rules it saw last, not rules buried at the top.
function extractNonNegotiableRules(masterPrompt: string): string {
  const m = masterPrompt.match(/##\s*NON-NEGOTIABLE RULES\s*\n([\s\S]*?)(?:\n---|\n##\s)/)
  return m ? m[1].trim() : ''
}

function buildSystemPrompt(
  agency: string,
  clientContext: string,
  avoidTopics: string,
  postStructure: string,
  masterPreamble?: string | null
): string {
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
- Available site pages: when linking internally for SEO value, prefer URLs from the available site pages list over invented paths.` : ''

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
${avoidTopics ? `\nTopics already covered — do NOT repeat:\n${avoidTopics}` : ''}${rulesReminder}`
  }

  return `You are a professional SEO content writer for ${agency}.

${jsonFormat}
${clientContext ? `\n${clientContext}` : ''}
${contextRules}
Your writing demonstrates E-E-A-T (Experience, Expertise, Authority, Trustworthiness).

Topic strategy:
- Answer real questions the target audience searches for
- Consider seasonal relevance and local industry angles
- Write about subjects tied to the business's services and value proposition
- Avoid vague titles; be specific and targeted
${postStructure ? `\nPost structure to follow:\n${postStructure}` : ''}

SEO guidelines:
- Clear focus keyword in H1, first paragraph, and 2–3 subheadings
- ~1% keyword density (roughly once per 100 words)
- Meta description: 150–160 characters, includes focus keyword
- SEO title: max 60 chars, includes focus keyword
- URL slug: lowercase, hyphens, no stop words, max 5–6 words
- End with a clear call-to-action
- Include at least 1 outbound link to a credible external resource when factually relevant
- Add descriptive alt text to any <img> tags including the focus keyword
- External links: target="_blank" rel="noopener noreferrer"
- Internal links: use relative paths when linking within the same domain
${avoidTopics ? `\nTopics already covered — do NOT repeat:\n${avoidTopics}` : ''}`
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
}: {
  db:               ReturnType<typeof createAdminClient>
  topicId:          string
  effectiveClientId: string
  topicData:        TopicData
  agencySettings:   AgencySettings
  suppressEmail:    boolean
}): Promise<void> {
  const provider = agencySettings.ai_provider || 'anthropic'
  const model    = agencySettings.ai_model    || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o')
  const apiKey   = agencySettings.ai_api_key
  const agency   = agencySettings.agency_name || 'the agency'

  try {
    // ── Load all settings in parallel ────────────────────────────────────────
    const [clientSettingsRes, globalSettingsRes, existingPostsRes, sitemapPagesRes] = await Promise.all([
      db.from('content_settings')
        .select('business_background, services, target_audience, geographic_focus, brand_voice, post_structure, sitemap_url, sitemap_urls, manual_link_urls, phone_number, target_length, connection_id, cta_list, publish_time, eeat_data, topic_guidelines')
        .eq('client_id', effectiveClientId)
        .maybeSingle(),
      db.from('content_settings')
        .select('post_structure')
        .is('client_id', null)
        .maybeSingle(),
      db.from('content_posts')
        .select('focus_topic, title')
        .eq('client_id', effectiveClientId)
        .order('generated_at', { ascending: false })
        .limit(50),
      db.from('content_sitemap_pages')
        .select('url, is_priority, is_excluded, created_at')
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
    }

    const sitemapRows  = (sitemapPagesRes.data ?? []) as { url: string; is_priority: boolean; is_excluded: boolean; created_at: string }[]
    const priorityUrls = sitemapRows.filter(r => r.is_priority).map(r => r.url)
    const excludedUrls = sitemapRows.filter(r => r.is_excluded).map(r => r.url)
    if (priorityUrls.length > 0) contextLines.push(`\nPriority pages — prefer for internal links when contextually relevant:\n${priorityUrls.join('\n')}`)
    if (excludedUrls.length > 0) contextLines.push(`\nExcluded pages — do NOT link to or reference these:\n${excludedUrls.join('\n')}`)

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

    if (cacheIsFresh1) {
      const generalPages = sitemapRows
        .filter(r => !r.is_priority && !r.is_excluded)
        .map(r => ({ url: r.url, score: scoreUrlRelevance(r.url, topicKws) }))
        .sort((a, b) => b.score - a.score)
        .map(r => r.url)
        .slice(0, sitemapPageCap - priorityUrls.length)
      if (generalPages.length > 0)
        contextLines.push(`\nAvailable site pages for internal linking:\n${generalPages.join('\n')}`)
    } else if (sitemapUrls.length > 0) {
      const allPages = (await Promise.all(sitemapUrls.map(fetchSitemapPages))).flat()
      const excluded = new Set(excludedUrls)
      const scored   = Array.from(new Set(allPages))
        .filter(u => !excluded.has(u))
        .map(u => ({ url: u, score: scoreUrlRelevance(u, topicKws) }))
        .sort((a, b) => b.score - a.score)
        .map(r => r.url)
        .slice(0, sitemapPageCap)
      if (scored.length > 0)
        contextLines.push(`\nAvailable site pages for internal linking:\n${scored.join('\n')}`)
    }

    const clientContext = contextLines.length > 0 ? `Client context:\n${contextLines.join('\n')}\n` : ''

    const existingPosts = (existingPostsRes.data ?? []) as { focus_topic?: string; title?: string }[]
    const avoidList = existingPosts
      .map(p => p.focus_topic || p.title)
      .filter(Boolean)
      .slice(0, 30)
      .join('\n')

    const postStructure = mergePostStructures(
      globalSettings?.post_structure,
      clientSettings?.post_structure as string | undefined
    )

    // ── Master writing prompt ──────────────────────────────────────────────────
    let masterPreamble: string | null = null
    const rawMasterPrompt = agencySettings.master_writing_prompt
    if (rawMasterPrompt && clientSettings) {
      const { data: cl } = await db.from('clients').select('name').eq('id', effectiveClientId).single()
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
        .replace(/\[SOURCES\]/g,            'Research and cite 2–4 credible external sources (gov, edu, original studies, recognized industry publications) yourself')
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

    const systemPrompt = buildSystemPrompt(agency, clientContext, avoidList, postStructure, masterPreamble)
      + eeatSection + restrictionSection

    // ── Build user prompt ──────────────────────────────────────────────────────
    const targetLength = (clientSettings?.target_length as number | null) ?? 1500
    const [gscLinks, manualLinks] = await Promise.all([
      getGscInternalLinks(db, effectiveClientId, topicData.target_keyword),
      Promise.resolve(parseManualLinks((clientSettings?.manual_link_urls as string[] | null) ?? [])),
    ])

    const internalLinkLines: string[] = []
    if (gscLinks.length > 0) {
      internalLinkLines.push('GSC-suggested internal links (pages ranking page 2 — reinforce with a link from this post):')
      gscLinks.forEach(l => internalLinkLines.push(`  - ${l.url}  (query: "${l.query}", pos ${l.position})`))
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
      if (brief.internal_link_targets?.length > 0)
        briefLines.push(`\nRequired internal links (must appear in the post with contextually natural anchor text):\n${brief.internal_link_targets.map((u: string) => `  - ${u}`).join('\n')}`)
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
        .select('name, hub_page_url, hub_page_title, central_entity')
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

        const siblingLines = (siblings ?? [])
          .filter((s: { title: string | null; published_url: string | null; target_keyword: string | null }) => s.published_url && s.title)
          .map((s: { title: string | null; published_url: string | null; target_keyword: string | null }) =>
            `  - "${s.title}" at ${s.published_url} — covers: ${s.target_keyword ?? 'n/a'}`)
          .join('\n')

        siloSection = `
TOPICAL SILO — INTERNAL LINKING STRATEGY:

Hub page (MUST include as an internal link in the first or second body section):
  Title: "${silo.hub_page_title ?? silo.name}"
  URL: ${silo.hub_page_url}
  Anchor text: use the central entity name or a specific descriptive phrase — NOT "click here" or "learn more"
  Central entity: ${silo.central_entity ?? silo.name}
${siblingLines ? `\nPublished cluster articles in this silo (link to 1–3 where this article shares a named entity, concept, or step — reason about semantic relevance, not just proximity):\n${siblingLines}` : ''}
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

    // ── Competitor gap analysis (from topic research) ─────────────────────────
    const competitorGapSection = (() => {
      const cr = topicData.competitors_researched
      if (!cr || Object.keys(cr.headings).length === 0) return ''
      const sections = Object.entries(cr.headings)
        .map(([url, hs]) => `  ${url}:\n    ${(hs as string[]).slice(0, 6).map((h: string) => `• ${h}`).join('\n    ')}`)
        .join('\n')
      return `\nCompetitor Analysis for "${cr.keyword}" — these competitors rank #1–5. FILL THE GAPS: go deeper, cover what they missed, add unique angles they skipped:\n${sections}`
    })()

    // ── Editor direction notes ────────────────────────────────────────────────
    const editNotesSection = topicData.edit_notes?.trim()
      ? `\nEditor Direction Notes (follow these closely for this specific post):\n${topicData.edit_notes}`
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

    const userPrompt = `Write a detailed, SEO-optimized blog post on the following topic:

Title: ${topicData.topic}
Target keyword: ${topicData.target_keyword || 'derive from topic'}
${topicData.rationale ? `Topic rationale: ${topicData.rationale}` : ''}
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

    const wc       = computeWordCount(parsed.content)
    const seoScore = scoreSeoPost({
      html:         parsed.content,
      title:        parsed.title,
      metaDesc:     parsed.metaDescription || null,
      slug:         parsed.slug || null,
      wordCount:    wc,
      targetLength: (clientSettings?.target_length as number | null) ?? 1500,
      brief,
    })

    const { data: savedPost, error: insertError } = await db.from('content_posts').insert({
      client_id:           effectiveClientId,
      connection_id:       connectionId,
      status:              'for_review',
      title:               parsed.title,
      seo_title:           parsed.seoTitle || parsed.title,
      content:             parsed.content,
      meta_description:    parsed.metaDescription,
      slug:                parsed.slug,
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
      target_publish_date: topicData.target_publish_date ?? null,
      seo_score:           seoScore,
      schema_type:         brief?.schema_type ?? null,
      excerpt:             parsed.metaDescription || null,
      silo_id:             topicData.silo_id ?? null,
    }).select('id').single()

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

    // Auto-generate featured image in background if key is configured
    if (agencySettings.openai_api_key || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY) {
      waitUntil(
        generatePostImage(db, savedPost.id, agencySettings.openai_api_key).catch(() => {})
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
        const { data: cl } = await db.from('clients').select('name, discord_channel_id').eq('id', effectiveClientId).single()
        clientName = (cl as { name?: string } | null)?.name ?? ''
        discordChannelId = (cl as { discord_channel_id?: string | null } | null)?.discord_channel_id ?? null
      } catch {}

      if (agencySettings.notification_email && agencySettings.notify_post_generated) {
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

      if (agencySettings.discord_bot_token && discordChannelId) {
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

  const body = await parseBody<{
    prompt?:         string
    client_id?:      string
    topic_id?:       string
    suppress_email?: boolean
  }>(request)
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  const { prompt, client_id, topic_id, suppress_email } = body

  if (!prompt && !topic_id) {
    return NextResponse.json({ error: 'Missing prompt or topic_id' }, { status: 400 })
  }

  const db = createAdminClient()

  // ── Load agency settings ─────────────────────────────────────────────────
  const { data: agencySettings } = await db
    .from('agency_settings')
    .select('ai_provider, ai_model, ai_api_key, openai_api_key, agency_name, notification_email, notify_post_generated, notify_post_uploaded, master_writing_prompt, discord_bot_token')
    .single()

  if (!agencySettings?.ai_api_key) {
    return NextResponse.json({ error: 'AI not configured. Add an API key in Agency Settings.' }, { status: 400 })
  }

  // ── Topic-based path — fire-and-forget with waitUntil ─────────────────────
  if (topic_id) {
    const { data: topic, error: topicErr } = await db
      .from('content_topics')
      .select('id, topic, rationale, target_keyword, page_to_support, client_id, target_publish_date, search_intent, secondary_keywords, seo_brief, competitors_researched, edit_notes, silo_id')
      .eq('id', topic_id)
      .single()
    if (topicErr || !topic) {
      return NextResponse.json({ error: 'Topic not found' }, { status: 404 })
    }

    // Idempotency guard
    const { data: existing } = await db.from('content_topics').select('post_id').eq('id', topic_id).single()
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
    }))

    return NextResponse.json({ ok: true, queued: true })
  }

  // ── Manual prompt-based path — synchronous (ContentEditor needs the response) ──
  const provider         = (agencySettings.ai_provider as string | null) || 'anthropic'
  const model            = (agencySettings.ai_model    as string | null) || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o')
  const apiKey           = agencySettings.ai_api_key as string
  const agency           = (agencySettings.agency_name as string | null) || 'the agency'
  const effectiveClientId = client_id ?? null

  const [clientSettingsRes, globalSettingsRes, existingPostsRes, sitemapPagesRes] = await Promise.all([
    effectiveClientId
      ? db.from('content_settings')
          .select('business_background, services, target_audience, geographic_focus, brand_voice, post_structure, sitemap_url, sitemap_urls, manual_link_urls, phone_number, target_length, connection_id, cta_list, publish_time, eeat_data, topic_guidelines')
          .eq('client_id', effectiveClientId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('content_settings')
      .select('post_structure')
      .is('client_id', null)
      .maybeSingle(),
    effectiveClientId
      ? db.from('content_posts')
          .select('focus_topic, title')
          .eq('client_id', effectiveClientId)
          .order('generated_at', { ascending: false })
          .limit(50)
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
  }

  const sitemapRows  = (sitemapPagesRes.data ?? []) as { url: string; is_priority: boolean; is_excluded: boolean; created_at: string }[]
  const priorityUrls = sitemapRows.filter(r => r.is_priority).map(r => r.url)
  const excludedUrls = sitemapRows.filter(r => r.is_excluded).map(r => r.url)
  if (priorityUrls.length > 0) contextLines.push(`\nPriority pages — prefer for internal links when contextually relevant:\n${priorityUrls.join('\n')}`)
  if (excludedUrls.length > 0) contextLines.push(`\nExcluded pages — do NOT link to or reference these:\n${excludedUrls.join('\n')}`)

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
      .filter(r => !r.is_priority && !r.is_excluded)
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
  }

  const clientContext = contextLines.length > 0 ? `Client context:\n${contextLines.join('\n')}\n` : ''

  const existingPosts = (existingPostsRes.data ?? []) as { focus_topic?: string; title?: string }[]
  const avoidList = existingPosts
    .map(p => p.focus_topic || p.title)
    .filter(Boolean)
    .slice(0, 30)
    .join('\n')

  const postStructure = mergePostStructures(
    globalSettings?.post_structure,
    clientSettings?.post_structure as string | undefined
  )

  // Master writing prompt for manual path (topic-specific vars will be empty)
  let masterPreamble: string | null = null
  const rawMasterPrompt = (agencySettings as Record<string, unknown>).master_writing_prompt as string | null
  if (rawMasterPrompt && clientSettings && effectiveClientId) {
    const { data: cl } = await db.from('clients').select('name').eq('id', effectiveClientId).single()
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
      .replace(/\[SOURCES\]/g,            'Research and cite 2–4 credible external sources (gov, edu, original studies, recognized industry publications) yourself')
      .replace(/\[[A-Z_]+\]/g, '')
  }

  const manualEeatFormatted = formatEeat(clientSettings?.eeat_data)
  const manualEeatSection   = manualEeatFormatted
    ? `\nE-E-A-T Credibility Signals — weave naturally into the post: ${manualEeatFormatted}`
    : ''
  const manualRestrictionSection = (clientSettings?.topic_guidelines as string | null | undefined)?.trim()
    ? `\nContent Restrictions (strictly enforced — never violate these):\n${clientSettings!.topic_guidelines}`
    : ''

  const systemPrompt = buildSystemPrompt(agency, clientContext, avoidList, postStructure, masterPreamble)
    + manualEeatSection + manualRestrictionSection

  let rawText: string
  try {
    rawText = await callAI(provider, model, apiKey, systemPrompt, prompt!)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }

  const parsed = parseResponse(rawText)

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
    const wc       = computeWordCount(parsed.content)
    const seoScore = scoreSeoPost({
      html:         parsed.content,
      title:        parsed.title,
      metaDesc:     parsed.metaDescription || null,
      slug:         parsed.slug || null,
      wordCount:    wc,
      targetLength: (clientSettings?.target_length as number | null) ?? 1500,
      brief:        null,
    })
    const { data: savedPost, error: insertError } = await db.from('content_posts').insert({
      client_id:        effectiveClientId,
      connection_id:    connectionId,
      status:           'for_review',
      title:            parsed.title,
      seo_title:        parsed.seoTitle || parsed.title,
      content:          parsed.content,
      meta_description: parsed.metaDescription,
      slug:             parsed.slug,
      target_keyword:   parsed.focusKeyword,
      focus_topic:      null,
      topic_rationale:  null,
      suggested_tags:   parsed.suggestedTags,
      word_count:       wc,
      heading_count:    computeHeadingCount(parsed.content),
      internal_links:   computeInternalLinks(parsed.content),
      generated_by:     'manual',
      ai_model:         model,
      prompt_used:      prompt ?? '',
      seo_score:        seoScore,
      schema_type:      null,
      excerpt:          parsed.metaDescription || null,
    }).select('id').single()
    if (insertError) {
      return NextResponse.json({ error: `Failed to save post: ${insertError.message}` }, { status: 500 })
    }
    postId = savedPost?.id ?? null

    // Auto-generate featured image in background
    if (postId && (agencySettings.openai_api_key || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY)) {
      waitUntil(
        generatePostImage(db, postId, agencySettings.openai_api_key).catch(() => {})
      )
    }
  }

  return NextResponse.json({ ...parsed, post_id: postId })
}
