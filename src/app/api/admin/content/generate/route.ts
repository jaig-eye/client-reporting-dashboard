import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import { sendEmail } from '@/lib/email'
import { scoreSeoPost } from '@/lib/content/scoreSeoPost'
import type { SeoBrief } from '@/lib/content/types'

export const maxDuration = 300

/**
 * POST /api/admin/content/generate
 *
 * Two input paths:
 *   1. { topic_id }         — generate from an approved topic (auto-flow)
 *   2. { prompt, client_id? } — manual prompt-based generation
 *
 * Returns: { post_id, title, seoTitle, content, metaDescription, slug, focusKeyword, suggestedTags }
 */

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

  // Aggregate by page: sum impressions, weighted avg position, pick best query
  const pageMap = new Map<string, {
    totalImpr: number; weightedPos: number; bestQuery: string
  }>()
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

function mergePostStructures(
  globalStructure?: string | null,
  clientStructure?: string | null
): string {
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

// Escape literal control characters that appear inside JSON string values.
// State-machine approach so structural whitespace (between fields) is untouched.
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

function parseResponse(rawText: string) {
  const stripped  = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  const jsonMatch = stripped.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    // Try raw first, then with control-char repair (handles literal newlines in HTML values)
    for (const attempt of [jsonMatch[0], repairJsonStrings(jsonMatch[0])]) {
      try {
        const parsed = JSON.parse(attempt)
        return {
          title:           String(parsed.title           || ''),
          seoTitle:        String(parsed.seoTitle        || parsed.title || ''),
          content:         String(parsed.content         || rawText),
          metaDescription: String(parsed.metaDescription || ''),
          slug:            String(parsed.slug            || ''),
          focusKeyword:    String(parsed.focusKeyword    || ''),
          suggestedTags:   Array.isArray(parsed.suggestedTags) ? parsed.suggestedTags.map(String) : [],
        }
      } catch { /* try next */ }
    }
  }
  // Last resort: JSON was truncated or unparseable — extract each field via regex
  // so title/slug/meta/content are all recovered even if the JSON is incomplete.
  function extractStr(field: string): string {
    const m = rawText.match(new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*?)(?:"|$)`, 's'))
    return m ? m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\') : ''
  }
  const title   = extractStr('title')
  const content = extractStr('content')
  return {
    title,
    seoTitle:        extractStr('seoTitle') || title,
    content:         content || rawText,
    metaDescription: extractStr('metaDescription'),
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

  if (masterPreamble) {
    return `${masterPreamble}

${jsonFormat}
${clientContext ? `\n${clientContext}` : ''}
${postStructure ? `\nPost structure to follow:\n${postStructure}` : ''}
${avoidTopics ? `\nTopics already covered — do NOT repeat:\n${avoidTopics}` : ''}`
  }

  return `You are a professional SEO content writer for ${agency}.

${jsonFormat}
${clientContext ? `\n${clientContext}` : ''}
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

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { prompt, client_id, topic_id } = body as {
    prompt?:    string
    client_id?: string
    topic_id?:  string
  }

  if (!prompt && !topic_id) {
    return NextResponse.json({ error: 'Missing prompt or topic_id' }, { status: 400 })
  }

  const db = createAdminClient()

  // ── Load agency settings ───────────────────────────────────────────────────
  const { data: agencySettings } = await db
    .from('agency_settings')
    .select('ai_provider, ai_model, ai_api_key, agency_name, notification_email, notify_post_generated, notify_post_uploaded, master_writing_prompt')
    .single()

  if (!agencySettings?.ai_api_key) {
    return NextResponse.json({ error: 'AI not configured. Add an API key in Agency Settings.' }, { status: 400 })
  }

  const provider = agencySettings.ai_provider || 'anthropic'
  const model    = agencySettings.ai_model    || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o')
  const apiKey   = agencySettings.ai_api_key
  const agency   = agencySettings.agency_name || 'the agency'

  // ── Resolve effective client_id and topic data ─────────────────────────────
  type TopicData = { id: string; topic: string; rationale: string | null; target_keyword: string | null; page_to_support: string | null; target_publish_date: string | null; search_intent: string | null; secondary_keywords: string | null; seo_brief: SeoBrief | null }

  let effectiveClientId = client_id ?? null
  let topicData: TopicData | null = null

  if (topic_id) {
    const { data: topic, error: topicErr } = await db
      .from('content_topics')
      .select('id, topic, rationale, target_keyword, page_to_support, client_id, target_publish_date, search_intent, secondary_keywords, seo_brief')
      .eq('id', topic_id)
      .single()
    if (topicErr || !topic) {
      return NextResponse.json({ error: 'Topic not found' }, { status: 404 })
    }
    topicData         = topic as unknown as TopicData
    effectiveClientId = (topic as unknown as { client_id: string }).client_id

    // Idempotency guard: if topic already has a linked post, return it
    const { data: topicIdempotency } = await db.from('content_topics').select('post_id').eq('id', topic_id).single()
    if ((topicIdempotency as { post_id: string | null } | null)?.post_id) {
      return NextResponse.json({ ok: true, postId: (topicIdempotency as { post_id: string }).post_id, skipped: true })
    }

    // Mark topic as generating so UI shows progress immediately
    await db.from('content_topics').update({ status: 'generating' }).eq('id', topic_id)
  }

  // ── Load client settings + global settings in parallel ────────────────────
  const [clientSettingsRes, globalSettingsRes, existingPostsRes, sitemapPagesRes] = await Promise.all([
    effectiveClientId
      ? db.from('content_settings')
          .select('business_background, services, target_audience, geographic_focus, brand_voice, post_structure, sitemap_url, sitemap_urls, manual_link_urls, phone_number, target_length, connection_id, cta_list, publish_time')
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
          .select('url, is_priority, is_excluded')
          .eq('client_id', effectiveClientId)
      : Promise.resolve({ data: null }),
  ])

  const clientSettings = clientSettingsRes.data as Record<string, unknown> | null
  const globalSettings = globalSettingsRes.data as { post_structure?: string } | null

  // ── Fetch sitemap pages for internal link context ──────────────────────────
  const contextLines: string[] = []
  if (clientSettings) {
    if (clientSettings.business_background) contextLines.push(`Business background: ${clientSettings.business_background}`)
    if (clientSettings.services)            contextLines.push(`Services offered: ${clientSettings.services}`)
    if (clientSettings.target_audience)     contextLines.push(`Target audience: ${clientSettings.target_audience}`)
    if (clientSettings.geographic_focus)    contextLines.push(`Geographic focus: ${clientSettings.geographic_focus}`)
    if (clientSettings.brand_voice)         contextLines.push(`Brand voice: ${clientSettings.brand_voice}`)
    if (clientSettings.phone_number) {
      const ph = String(clientSettings.phone_number)
      contextLines.push(`Business phone: ${ph} (link as <a href="tel:${ph.replace(/\D/g, '')}">)`)
    }
  }

  // Sitemap priority/excluded pages from DB
  const sitemapRows = (sitemapPagesRes.data ?? []) as { url: string; is_priority: boolean; is_excluded: boolean }[]
  const priorityUrls = sitemapRows.filter(r => r.is_priority).map(r => r.url)
  const excludedUrls = sitemapRows.filter(r => r.is_excluded).map(r => r.url)
  if (priorityUrls.length > 0) {
    contextLines.push(`\nPriority pages — prefer for internal links when contextually relevant:\n${priorityUrls.join('\n')}`)
  }
  if (excludedUrls.length > 0) {
    contextLines.push(`\nExcluded pages — do NOT link to or reference these:\n${excludedUrls.join('\n')}`)
  }

  // Multi-sitemap: sitemap_urls[] first, fall back to legacy sitemap_url
  const sitemapUrls: string[] = (() => {
    const urls = clientSettings?.sitemap_urls
    if (Array.isArray(urls) && urls.length > 0) return urls as string[]
    if (clientSettings?.sitemap_url) return [clientSettings.sitemap_url as string]
    return []
  })()

  if (sitemapUrls.length > 0) {
    const allPages = (await Promise.all(sitemapUrls.map(fetchSitemapPages))).flat()
    // Filter out excluded pages and limit remaining
    const excluded  = new Set(excludedUrls)
    const unique    = Array.from(new Set(allPages)).filter(u => !excluded.has(u)).slice(0, 60)
    if (unique.length > 0) {
      contextLines.push(`\nAvailable site pages for internal linking:\n${unique.join('\n')}`)
    }
  }

  const clientContext = contextLines.length > 0 ? `Client context:\n${contextLines.join('\n')}\n` : ''

  // ── Avoid topics list ──────────────────────────────────────────────────────
  const existingPosts = (existingPostsRes.data ?? []) as { focus_topic?: string; title?: string }[]
  const avoidList = existingPosts
    .map(p => p.focus_topic || p.title)
    .filter(Boolean)
    .slice(0, 30)
    .join('\n')

  // ── Merged post structure ──────────────────────────────────────────────────
  const postStructure = mergePostStructures(
    globalSettings?.post_structure,
    clientSettings?.post_structure as string | undefined
  )

  // Master writing prompt — substitute client Brand DNA variables if template is set
  let masterPreamble: string | null = null
  const rawMasterPrompt = (agencySettings as Record<string, unknown>).master_writing_prompt as string | null
  if (rawMasterPrompt && clientSettings) {
    let clientName = ''
    if (effectiveClientId) {
      const { data: cl } = await db.from('clients').select('name').eq('id', effectiveClientId).single()
      clientName = (cl as { name?: string } | null)?.name ?? ''
    }
    // Build always-include links string for [URLS_AND_ANCHORS]
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
      .replace(/\[PRIMARY_KEYWORD\]/g,   topicData?.target_keyword ?? '')
      .replace(/\[WORKING_TITLE\]/g,     topicData?.topic ?? '')
      .replace(/\[SECONDARY_KEYWORDS\]/g, topicData?.secondary_keywords ?? '(derive LSI terms from topic and primary keyword)')
      .replace(/\[SEARCH_INTENT\]/g,      topicData?.search_intent ?? 'informational')
      // Also handle the exact dropdown-style placeholder from the template
      .replace(/\[informational \| commercial \| transactional \| navigational\]/g, topicData?.search_intent ?? 'informational')
      .replace(/\[URLS_AND_ANCHORS\]/g,   urlsAndAnchors)
      .replace(/\[CTA\]/g,                String(clientSettings.cta_list ?? 'Contact us to learn more'))
      .replace(/\[SOURCES\]/g,            'Research and cite 2–4 credible external sources (gov, edu, original studies, recognized industry publications) yourself')
      // Strip any remaining unreplaced [PLACEHOLDER] tokens
      .replace(/\[[A-Z_]+\]/g, '')
  }

  const systemPrompt = buildSystemPrompt(agency, clientContext, avoidList, postStructure, masterPreamble)

  // ── Build user prompt ──────────────────────────────────────────────────────
  let userPrompt: string
  const targetLength = (clientSettings?.target_length as number | null) ?? 1500

  if (topicData && effectiveClientId) {
    // Topic-driven generation with GSC-aware internal links
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
      if (brief.h2_outline?.length > 0) {
        briefLines.push(`\nRequired H2 structure (follow this outline — expand each section):\n${brief.h2_outline.map((h, i) => `  ${i + 1}. ${h}`).join('\n')}`)
      }
      if (brief.internal_link_targets?.length > 0) {
        briefLines.push(`\nRequired internal links (must appear in the post with contextually natural anchor text):\n${brief.internal_link_targets.map(u => `  - ${u}`).join('\n')}`)
      }
      if (brief.faq_opportunities?.length > 0) {
        briefLines.push(`\nInclude a FAQ section addressing these questions:\n${brief.faq_opportunities.map(q => `  - ${q}`).join('\n')}`)
      }
      if (brief.local_seo_angle) {
        briefLines.push(`\nLocal SEO angle to weave in: ${brief.local_seo_angle}`)
      }
      if (brief.cta_text) {
        briefLines.push(`\nClosing CTA to use: ${brief.cta_text}`)
      }
      if (brief.unique_angle) {
        briefLines.push(`\nUnique content angle: ${brief.unique_angle}`)
      }
      if (brief.meta_description) {
        briefLines.push(`\nTarget meta description (150–160 chars): ${brief.meta_description}`)
      }
      if (brief.schema_type) {
        briefLines.push(`\nContent schema type: ${brief.schema_type}`)
      }
    }

    userPrompt = `Write a detailed, SEO-optimized blog post on the following topic:

Title: ${topicData.topic}
Target keyword: ${topicData.target_keyword || 'derive from topic'}
${topicData.rationale ? `Topic rationale: ${topicData.rationale}` : ''}
${topicData.page_to_support ? `Core page to support (must appear as an internal link): ${topicData.page_to_support}` : ''}
${internalLinkLines.length > 0 ? '\n' + internalLinkLines.join('\n') : ''}
${briefLines.length > 0 ? briefLines.join('\n') : ''}

Target approximately ${brief?.word_count_target ?? targetLength} words.`
  } else if (prompt) {
    // Manual prompt-based generation
    userPrompt = prompt
  } else {
    return NextResponse.json({ error: 'Missing prompt' }, { status: 400 })
  }

  // ── Generate with AI ───────────────────────────────────────────────────────
  let rawText: string
  try {
    rawText = await callAI(provider, model, apiKey, systemPrompt, userPrompt)
  } catch (err) {
    if (topic_id) {
      await db.from('content_topics')
        .update({ status: 'scheduled', generation_error: String(err) })
        .eq('id', topic_id)
    }
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }

  const parsed = parseResponse(rawText)

  // ── Save to content_posts ──────────────────────────────────────────────────
  let postId: string | null = null
  if (effectiveClientId) {
    let connectionId = (clientSettings?.connection_id as string | null) ?? null
    if (!connectionId && effectiveClientId) {
      const { data: fallbackConn } = await db
        .from('client_connections')
        .select('id, connector:connectors!inner(type)')
        .eq('client_id', effectiveClientId)
        .eq('status', 'active')
        .eq('connector.type', 'wordpress')
        .limit(1)
        .maybeSingle()
      connectionId = (fallbackConn as { id: string } | null)?.id ?? null
    }
    const wc     = computeWordCount(parsed.content)
    const brief  = topicData?.seo_brief ?? null
    const seoScore = scoreSeoPost({
      html:         parsed.content,
      title:        parsed.title,
      metaDesc:     parsed.metaDescription || null,
      slug:         parsed.slug || null,
      wordCount:    wc,
      targetLength: (clientSettings?.target_length as number | null) ?? 1500,
      brief,
    })

    const postRow = {
      client_id:           effectiveClientId,
      connection_id:       connectionId,
      status:              'pending',
      title:               parsed.title,
      seo_title:           parsed.seoTitle || parsed.title,
      content:             parsed.content,
      meta_description:    parsed.metaDescription,
      slug:                parsed.slug,
      target_keyword:      parsed.focusKeyword,
      focus_topic:         topicData?.topic ?? null,
      topic_rationale:     topicData?.rationale ?? null,
      suggested_tags:      parsed.suggestedTags,
      word_count:          wc,
      heading_count:       computeHeadingCount(parsed.content),
      internal_links:      computeInternalLinks(parsed.content),
      generated_by:        topic_id ? 'topic' : 'manual',
      ai_model:            model,
      prompt_used:         userPrompt,
      target_publish_date: topicData?.target_publish_date ?? null,
      seo_score:           seoScore,
      schema_type:         brief?.schema_type ?? null,
      excerpt:             parsed.metaDescription || null,
    }
    const { data: savedPost, error: insertError } = await db.from('content_posts').insert(postRow).select('id').single()
    postId = savedPost?.id ?? null

    if (insertError) {
      if (topic_id) {
        await db.from('content_topics')
          .update({ status: 'scheduled', generation_error: `DB error: ${insertError.message}` })
          .eq('id', topic_id)
      }
      return NextResponse.json({ error: `Failed to save post: ${insertError.message}` }, { status: 500 })
    }

    // Link post back to topic
    if (topic_id && postId) {
      await db
        .from('content_topics')
        .update({ post_id: postId, status: 'generated', generation_error: null })
        .eq('id', topic_id)
    }

    // Email notification — post generated
    const notifEmail = agencySettings.notification_email as string | null
    if (postId && notifEmail && agencySettings.notify_post_generated) {
      const agencyName  = agencySettings.agency_name || 'Agency Dashboard'
      const appUrl      = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
      const publishDate = topicData?.target_publish_date ?? null
      const dateLabel   = publishDate ? ` — publishes ${publishDate}` : ''
      try {
        let clientName = ''
        if (effectiveClientId) {
          const { data: cl } = await db.from('clients').select('name').eq('id', effectiveClientId).single()
          clientName = (cl as { name?: string } | null)?.name ?? ''
        }
        await sendEmail({
          to:      notifEmail,
          subject: `[${agencyName}] Post ready for review: ${parsed.title}`,
          html: `<p>A new post has been generated for <strong>${clientName || 'a client'}</strong> and is ready for review: <strong>${parsed.title}</strong>${dateLabel}.</p>
                 <p><a href="${appUrl}/admin/clients/${effectiveClientId}?tab=content&amp;subtab=schedule">Review Post →</a></p>`,
        })
      } catch (emailErr) {
        console.error('[generate] email error:', emailErr)
      }
    }

    // Auto-upload to WordPress as a draft when a connection is configured
    if (postId && connectionId) {
      try {
        const { data: connRow } = await db
          .from('client_connections')
          .select('connector:connectors(auth, config)')
          .eq('id', connectionId)
          .single()

        type ConnRow = { connector: { auth: Record<string, unknown>; config: Record<string, unknown> } | null }
        const conn   = connRow as unknown as ConnRow | null
        const auth   = conn?.connector?.auth   as { username: string; app_password: string } | undefined
        const config = conn?.connector?.config as { site_url: string } | undefined

        if (auth?.username && auth?.app_password && config?.site_url) {
          const { publishPost } = await import('@/lib/connectors/wordpress')
          const today           = new Date().toISOString().split('T')[0]
          const publishDate     = topicData?.target_publish_date ?? null
          const wpStatus        = (publishDate && publishDate > today) ? 'future' : 'draft'
          const wpResult = await publishPost(config.site_url, auth, {
            title:   parsed.title,
            content: parsed.content,
            status:  wpStatus,
            ...(publishDate ? { date: `${publishDate}T${(clientSettings?.publish_time as string | null) ?? '09:00'}:00` } : {}),
            slug:    parsed.slug || undefined,
            excerpt: parsed.metaDescription || undefined,
            meta: {
              rank_math_title:          parsed.seoTitle        || parsed.title,
              rank_math_description:    parsed.metaDescription || '',
              rank_math_focus_keyword:  parsed.focusKeyword    || '',
              ...(brief?.schema_type ? { _schema_type: brief.schema_type } : {}),
              ...(brief?.alt_text    ? { _featured_image_alt: brief.alt_text } : {}),
            },
          })
          await db.from('content_posts').update({
            wp_post_id:  wpResult.id,
            wp_status:   wpStatus,
            wp_site_url: config.site_url,
            status:      'draft_saved',
            ...(publishDate ? { target_publish_date: publishDate } : {}),
          }).eq('id', postId)

          // Email notification — post uploaded to WordPress
          const notifEmail = agencySettings.notification_email as string | null
          if (notifEmail && agencySettings.notify_post_uploaded) {
            const agencyName = agencySettings.agency_name || 'Agency Dashboard'
            const appUrl     = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
            try {
              let clientName = ''
              if (effectiveClientId) {
                const { data: cl } = await db.from('clients').select('name').eq('id', effectiveClientId).single()
                clientName = (cl as { name?: string } | null)?.name ?? ''
              }
              const wpPostUrl = wpResult.id && config?.site_url
                ? `${String(config.site_url).replace(/\/$/, '')}/?p=${wpResult.id}`
                : null
              await sendEmail({
                to:      notifEmail,
                subject: `[${agencyName}] Post on WordPress${publishDate ? ` — ${publishDate}` : ''}: ${parsed.title}`,
                html: `<p>A post for <strong>${clientName || 'a client'}</strong> has been uploaded to WordPress${publishDate ? ` and scheduled for <strong>${publishDate}</strong>` : ' as a draft'}: <strong>${parsed.title}</strong>.</p>
                       ${wpPostUrl ? `<p><a href="${wpPostUrl}">Preview on WordPress →</a></p>` : ''}
                       <p><a href="${appUrl}/admin/clients/${effectiveClientId ?? ''}?tab=content">View in Dashboard →</a></p>`,
              })
            } catch (emailErr) {
              console.error('[generate] WP-upload email error:', emailErr)
            }
          }
        }
      } catch (wpErr) {
        console.error('[generate] WP auto-draft failed:', wpErr)
        // Leave post as 'pending' — do not rethrow
      }
    }
  }

  return NextResponse.json({ ...parsed, post_id: postId })
}
