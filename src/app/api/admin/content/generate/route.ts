import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

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

function parseResponse(rawText: string) {
  const stripped  = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  const jsonMatch = stripped.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return { title: '', seoTitle: '', content: rawText, metaDescription: '', slug: '', focusKeyword: '', suggestedTags: [] as string[] }
  try {
    const parsed = JSON.parse(jsonMatch[0])
    return {
      title:           String(parsed.title           || ''),
      seoTitle:        String(parsed.seoTitle        || parsed.title || ''),
      content:         String(parsed.content         || rawText),
      metaDescription: String(parsed.metaDescription || ''),
      slug:            String(parsed.slug            || ''),
      focusKeyword:    String(parsed.focusKeyword    || ''),
      suggestedTags:   Array.isArray(parsed.suggestedTags) ? parsed.suggestedTags.map(String) : [],
    }
  } catch {
    return { title: '', seoTitle: '', content: rawText, metaDescription: '', slug: '', focusKeyword: '', suggestedTags: [] as string[] }
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
  postStructure: string
): string {
  return `You are a professional SEO content writer for ${agency}.
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
${avoidTopics ? `\nTopics already covered — do NOT repeat:\n${avoidTopics}` : ''}
Return ONLY a JSON object with exactly these fields:
{
  "title": "Post H1 title — descriptive, includes focus keyword",
  "seoTitle": "SEO/meta title — max 60 chars",
  "content": "Full HTML post body (h2, h3, h4, p, ul, strong, a tags as needed)",
  "metaDescription": "150–160 characters, includes focus keyword",
  "slug": "url-friendly-slug-max-5-words",
  "focusKeyword": "primary target keyword phrase",
  "suggestedTags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}
Do not include markdown fences or any text outside the JSON object.`
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
      body: JSON.stringify({ model, max_tokens: 8192, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
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
    .select('ai_provider, ai_model, ai_api_key, agency_name')
    .single()

  if (!agencySettings?.ai_api_key) {
    return NextResponse.json({ error: 'AI not configured. Add an API key in Agency Settings.' }, { status: 400 })
  }

  const provider = agencySettings.ai_provider || 'anthropic'
  const model    = agencySettings.ai_model    || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o')
  const apiKey   = agencySettings.ai_api_key
  const agency   = agencySettings.agency_name || 'the agency'

  // ── Resolve effective client_id and topic data ─────────────────────────────
  type TopicData = { id: string; topic: string; rationale: string | null; target_keyword: string | null; page_to_support: string | null }

  let effectiveClientId = client_id ?? null
  let topicData: TopicData | null = null

  if (topic_id) {
    const { data: topic, error: topicErr } = await db
      .from('content_topics')
      .select('id, topic, rationale, target_keyword, page_to_support, client_id')
      .eq('id', topic_id)
      .single()
    if (topicErr || !topic) {
      return NextResponse.json({ error: 'Topic not found' }, { status: 404 })
    }
    topicData         = topic as unknown as TopicData
    effectiveClientId = (topic as unknown as { client_id: string }).client_id
  }

  // ── Load client settings + global settings in parallel ────────────────────
  const [clientSettingsRes, globalSettingsRes, existingPostsRes] = await Promise.all([
    effectiveClientId
      ? db.from('content_settings')
          .select('business_background, services, target_audience, geographic_focus, brand_voice, post_structure, sitemap_url, sitemap_urls, manual_link_urls, phone_number, target_length, connection_id')
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

  // Multi-sitemap: sitemap_urls[] first, fall back to legacy sitemap_url
  const sitemapUrls: string[] = (() => {
    const urls = clientSettings?.sitemap_urls
    if (Array.isArray(urls) && urls.length > 0) return urls as string[]
    if (clientSettings?.sitemap_url) return [clientSettings.sitemap_url as string]
    return []
  })()

  if (sitemapUrls.length > 0) {
    const allPages = (await Promise.all(sitemapUrls.map(fetchSitemapPages))).flat()
    const unique   = Array.from(new Set(allPages)).slice(0, 60)
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

  const systemPrompt = buildSystemPrompt(agency, clientContext, avoidList, postStructure)

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

    userPrompt = `Write a detailed, SEO-optimized blog post on the following topic:

Title: ${topicData.topic}
Target keyword: ${topicData.target_keyword || 'derive from topic'}
${topicData.rationale ? `Topic rationale: ${topicData.rationale}` : ''}
${topicData.page_to_support ? `Core page to support (must appear as an internal link): ${topicData.page_to_support}` : ''}
${internalLinkLines.length > 0 ? '\n' + internalLinkLines.join('\n') : ''}

Target approximately ${targetLength} words.`
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
        .update({ status: 'approved', generation_error: String(err) })
        .eq('id', topic_id)
    }
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }

  const parsed = parseResponse(rawText)

  // ── Save to content_posts ──────────────────────────────────────────────────
  let postId: string | null = null
  if (effectiveClientId) {
    const connectionId = (clientSettings?.connection_id as string | null) ?? null
    const postRow = {
      client_id:        effectiveClientId,
      connection_id:    connectionId,
      status:           'pending',
      title:            parsed.title,
      seo_title:        parsed.seoTitle || parsed.title,
      content:          parsed.content,
      meta_description: parsed.metaDescription,
      slug:             parsed.slug,
      target_keyword:   parsed.focusKeyword,
      focus_topic:      topicData?.topic ?? null,
      suggested_tags:   parsed.suggestedTags,
      word_count:       computeWordCount(parsed.content),
      heading_count:    computeHeadingCount(parsed.content),
      internal_links:   computeInternalLinks(parsed.content),
      generated_by:     topic_id ? 'topic' : 'manual',
      ai_model:         model,
      prompt_used:      userPrompt,
    }
    const { data: savedPost } = await db.from('content_posts').insert(postRow).select('id').single()
    postId = savedPost?.id ?? null

    // Link post back to topic
    if (topic_id && postId) {
      await db
        .from('content_topics')
        .update({ post_id: postId, status: 'generated', generation_error: null })
        .eq('id', topic_id)
    }
  }

  return NextResponse.json({ ...parsed, post_id: postId })
}
