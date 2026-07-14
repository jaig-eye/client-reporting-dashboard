// Shared topic generation logic.
// Extracted from /api/admin/content/topics/generate/route.ts so both the
// per-client API route and the bulk calendar/generate route use identical logic.

import { createAdminClient }              from '@/lib/supabase/server'
import { sendEmail }                      from '@/lib/email'
import { buildTopicsEmail }               from '@/lib/content/emailTemplates'
import { researchCompetitors }            from '@/lib/content/competitorResearch'
import type { CompetitorResearch }        from '@/lib/content/competitorResearch'

interface TopicIdea {
  topic:               string
  target_keyword:      string
  search_intent:       string
  secondary_keywords:  string
  keyword_opportunity: string
  ranking_strategy:    string
  audience_intent:     string
  why_now:             string
  competition_level:   string
  cluster_group?:      string
}

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

function stripDomain(url: string): string {
  try { return new URL(url).pathname } catch { return url }
}

export interface TopicSummary {
  id:                  string
  topic:               string
  target_keyword:      string | null
  target_publish_date: string | null
  keyword_opportunity: string | null
}

export interface GenerateTopicsResult {
  topics:     TopicSummary[]
  clientName: string
  count:      number
  error?:     string
}

export async function generateTopicsForClient(
  db:       ReturnType<typeof createAdminClient>,
  clientId: string,
  count:    number,
  targetPublishDate?: string,
  opts?: { suppressEmail?: boolean; siloId?: string; contentType?: string },
): Promise<GenerateTopicsResult> {
  const windowStart = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10)

  const [
    settingsRes,
    clientRes,
    clientSettingsRes,
    existingTopicsRes,
    existingPostsRes,
    gscRawRes,
  ] = await Promise.all([
    db.from('agency_settings')
      .select('ai_provider, ai_model, ai_api_key, agency_name, notification_email, notify_topics_created, notify_topic_ready, serp_api_key')
      .single(),
    db.from('clients').select('id, name').eq('id', clientId).single(),
    db.from('content_settings')
      .select('business_background, services, target_audience, geographic_focus, brand_voice, phone_number, sitemap_url, sitemap_urls, eeat_data, topic_guidelines')
      .eq('client_id', clientId)
      .maybeSingle(),
    db.from('content_topics')
      .select('topic, target_keyword')
      .eq('client_id', clientId)
      .not('status', 'eq', 'rejected'),
    db.from('content_posts')
      .select('title, focus_topic, target_keyword')
      .eq('client_id', clientId)
      .gte('generated_at', new Date(Date.now() - 90 * 86_400_000).toISOString())
      .order('generated_at', { ascending: false })
      .limit(50),
    db.from('gsc_metrics')
      .select('page, query, clicks, impressions, position, ctr')
      .eq('client_id', clientId)
      .gte('date', windowStart)
      .not('page', 'ilike', '%?%')
      .not('query', 'eq', ''),
  ])

  if (!settingsRes.data?.ai_api_key) {
    return { topics: [], clientName: '', count: 0, error: 'AI not configured. Add an API key in Agency Settings.' }
  }

  const settings       = settingsRes.data
  const client         = clientRes.data
  const clientSettings = clientSettingsRes.data as Record<string, unknown> | null
  const clientName     = client?.name ?? 'this client'

  // ── Aggregate GSC 28-day data ──────────────────────────────────────────────
  type GscAgg = { totalClicks: number; totalImpr: number; weightedPos: number; weightedCtr: number; count: number }
  const gscMap = new Map<string, GscAgg>()

  for (const r of (gscRawRes.data ?? []) as { page: string; query: string; clicks: number; impressions: number; position: number; ctr: number }[]) {
    const key  = `${r.page}||${r.query}`
    const impr = r.impressions ?? 0
    const ex   = gscMap.get(key)
    if (ex) {
      const newImpr  = ex.totalImpr + impr
      ex.weightedPos = newImpr > 0 ? (ex.weightedPos * ex.totalImpr + (r.position ?? 0) * impr) / newImpr : ex.weightedPos
      ex.weightedCtr = newImpr > 0 ? (ex.weightedCtr * ex.totalImpr + (r.ctr ?? 0) * impr) / newImpr : ex.weightedCtr
      ex.totalClicks += r.clicks ?? 0
      ex.totalImpr    = newImpr
      ex.count++
    } else {
      gscMap.set(key, { totalClicks: r.clicks ?? 0, totalImpr: impr, weightedPos: r.position ?? 0, weightedCtr: r.ctr ?? 0, count: 1 })
    }
  }

  const topPages = Array.from(gscMap.entries())
    .map(([k, v]) => { const [page, query] = k.split('||'); return { page, query, ...v } })
    .sort((a, b) => b.totalClicks - a.totalClicks)
    .slice(0, 10)

  const growthTargets = Array.from(gscMap.entries())
    .map(([k, v]) => { const [page, query] = k.split('||'); return { page, query, ...v } })
    .filter(r => r.weightedPos > 9 && r.weightedPos <= 20 && r.totalImpr > 10)
    .sort((a, b) => b.totalImpr - a.totalImpr)
    .slice(0, 15)

  const quickWins = Array.from(gscMap.entries())
    .map(([k, v]) => { const [page, query] = k.split('||'); return { page, query, ...v } })
    .filter(r => r.weightedPos >= 5 && r.weightedPos < 10 && r.totalImpr > 5)
    .sort((a, b) => b.totalImpr - a.totalImpr)
    .slice(0, 10)

  const ctrIssues = Array.from(gscMap.entries())
    .map(([k, v]) => { const [page, query] = k.split('||'); return { page, query, ...v } })
    .filter(r => {
      if (r.weightedPos > 5) return false
      const floor = r.weightedPos <= 1 ? 0.20 : r.weightedPos <= 2 ? 0.10 : r.weightedPos <= 3 ? 0.07 : 0.04
      return r.weightedCtr < floor * 0.6 && r.totalImpr > 50
    })
    .sort((a, b) => b.totalImpr - a.totalImpr)
    .slice(0, 8)

  // ── Competitor research (optional — requires serp_api_key) ───────────────
  const competitorMap = new Map<string, CompetitorResearch>()
  const serpApiKey = (settings as Record<string, unknown>).serp_api_key as string | null
  if (serpApiKey && growthTargets.length > 0) {
    const toResearch = growthTargets.slice(0, 3)

    // Same-day keyword cache: reuse SerpAPI results within the same UTC day only
    const cacheWindowStart = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z'
    const { data: cachedRows } = await db
      .from('content_topics')
      .select('target_keyword, competitors_researched')
      .eq('client_id', clientId)
      .not('competitors_researched', 'is', null)
      .gte('created_at', cacheWindowStart)
    const serpCache = new Map<string, CompetitorResearch>()
    for (const row of (cachedRows ?? []) as { target_keyword: string; competitors_researched: unknown }[]) {
      if (row.competitors_researched && !serpCache.has(row.target_keyword)) {
        serpCache.set(row.target_keyword, row.competitors_researched as CompetitorResearch)
      }
    }

    // Only call SerpAPI for keywords not already in cache
    const toFetch = toResearch.filter(t => !serpCache.has(t.query))
    if (toFetch.length > 0) {
      const results = await Promise.allSettled(
        toFetch.map(t => researchCompetitors(t.query, serpApiKey))
      )
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value.urls.length > 0) {
          serpCache.set(toFetch[i].query, r.value)
        }
      })
    }

    // Merge cache hits + fresh results into competitorMap
    for (const t of toResearch) {
      const hit = serpCache.get(t.query)
      if (hit) competitorMap.set(t.query, hit)
    }
  }

  // ── Sitemap pages ──────────────────────────────────────────────────────────
  const sitemapUrls: string[] = (() => {
    const urls = clientSettings?.sitemap_urls
    if (Array.isArray(urls) && urls.length > 0) return urls as string[]
    if (clientSettings?.sitemap_url) return [String(clientSettings.sitemap_url)]
    return []
  })()

  const halfMonthAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()
  const { data: storedPages } = await db
    .from('content_sitemap_pages')
    .select('url, is_priority, is_excluded, created_at')
    .eq('client_id', clientId)

  const cacheIsFresh = storedPages && storedPages.length > 0 &&
    (storedPages as { created_at: string }[]).some(r => r.created_at >= halfMonthAgo)

  let sitemapPages: string[] = []
  const sitemapKeywords = growthTargets.map(t => t.query)

  if (cacheIsFresh) {
    const priority   = (storedPages as { url: string; is_priority: boolean; is_excluded: boolean }[]).filter(r => r.is_priority).map(r => r.url)
    const candidates = (storedPages as { url: string; is_priority: boolean; is_excluded: boolean }[])
      .filter(r => !r.is_priority && !r.is_excluded)
      .map(r => ({ url: r.url, score: scoreUrlRelevance(r.url, sitemapKeywords) }))
      .sort((a, b) => b.score - a.score)
      .map(r => r.url)
    sitemapPages = [...priority, ...candidates].slice(0, 60)
  } else if (sitemapUrls.length > 0) {
    const allPages = Array.from(new Set((await Promise.all(sitemapUrls.map(fetchSitemapPages))).flat()))
    sitemapPages = allPages
      .map(url => ({ url, score: scoreUrlRelevance(url, sitemapKeywords) }))
      .sort((a, b) => b.score - a.score)
      .map(r => r.url)
      .slice(0, 60)
  }

  // ── Avoid list ─────────────────────────────────────────────────────────────
  const existingTopics = (existingTopicsRes.data ?? []) as { topic: string; target_keyword?: string }[]
  const existingPosts  = (existingPostsRes.data ?? []) as { title?: string; focus_topic?: string; target_keyword?: string }[]
  const avoidSet       = new Set<string>()
  existingTopics.forEach(t => { if (t.topic) avoidSet.add(t.topic); if (t.target_keyword) avoidSet.add(t.target_keyword) })
  existingPosts.forEach(p => { if (p.focus_topic) avoidSet.add(p.focus_topic); if (p.title) avoidSet.add(p.title); if (p.target_keyword) avoidSet.add(p.target_keyword) })
  const avoidText = Array.from(avoidSet).slice(0, 50).join(', ')

  // ── E-E-A-T context ────────────────────────────────────────────────────────
  const eeat = clientSettings?.eeat_data as Record<string, unknown> | null
  let eeatText = ''
  if (eeat) {
    const parts: string[] = []
    if (eeat.years_in_business)    parts.push(`${eeat.years_in_business} years in business`)
    if (eeat.licenses)             parts.push(`Licenses: ${eeat.licenses}`)
    if (eeat.review_count)         parts.push(`${eeat.review_count} reviews`)
    if (eeat.guarantees)           parts.push(`Guarantees: ${eeat.guarantees}`)
    if (eeat.emergency_availability) parts.push('Emergency service available')
    if (parts.length) eeatText = `\nBusiness credibility: ${parts.join('; ')}`
  }

  // ── Prompt ─────────────────────────────────────────────────────────────────
  const contextLines: string[] = []
  if (clientSettings?.business_background) contextLines.push(`Business: ${clientSettings.business_background}`)
  if (clientSettings?.services)            contextLines.push(`Services: ${clientSettings.services}`)
  if (clientSettings?.target_audience)     contextLines.push(`Target audience: ${clientSettings.target_audience}`)
  if (clientSettings?.geographic_focus)    contextLines.push(`Geographic focus: ${clientSettings.geographic_focus}`)
  if (clientSettings?.brand_voice)         contextLines.push(`Brand voice: ${clientSettings.brand_voice}`)

  const gscTopText = topPages.length > 0
    ? `\nTop-performing pages:\n${topPages.slice(0, 8).map(p => `  - "${p.query}" → ${stripDomain(p.page)} (${p.totalClicks} clicks, pos ${p.weightedPos.toFixed(1)})`).join('\n')}`
    : ''

  const gscGrowthText = growthTargets.length > 0
    ? `\nPage-2 opportunities (pos 10–20) — PRIORITISE these. Each "Existing page" ALREADY EXISTS on the site; write a new SUPPORT article targeting the keyword and internally link it to that page:\n${growthTargets.slice(0, 12).map(p => `  - Keyword: "${p.query}" | Existing page: ${stripDomain(p.page)} (${p.totalImpr} impr, pos ${p.weightedPos.toFixed(1)})`).join('\n')}`
    : ''

  const gscQuickWinsText = quickWins.length > 0
    ? `\nNear-page-1 clusters (pos 5–9) — each "Existing page" ALREADY EXISTS; write adjacent long-tail SUPPORT articles that internally link back to strengthen these:\n${quickWins.map(p => `  - Keyword: "${p.query}" | Existing page: ${stripDomain(p.page)} (${p.totalImpr} impr, pos ${p.weightedPos.toFixed(1)})`).join('\n')}`
    : ''

  const gscCtrText = ctrIssues.length > 0
    ? `\nCTR gap opportunities (pos 1–5, CTR below expected for position) — each "Existing page" ranks well but needs topical depth articles:\n${ctrIssues.map(p => `  - Keyword: "${p.query}" | Existing page: ${stripDomain(p.page)} (${p.totalImpr} impr, pos ${p.weightedPos.toFixed(1)}, CTR ${(p.weightedCtr * 100).toFixed(1)}%)`).join('\n')}`
    : ''

  const sitemapText = sitemapPages.length > 0
    ? `\nExisting site pages (for internal link planning):\n${sitemapPages.slice(0, 60).map(stripDomain).join('\n')}`
    : ''

  const competitorText = competitorMap.size > 0
    ? `\nCompetitor analysis — write to FILL THE GAPS these competitors missed and improve on their coverage:\n` +
      Array.from(competitorMap.values()).map(cr => {
        // Deduplicate headings across all competitor URLs for this keyword
        const seen = new Set<string>()
        const deduped = Object.entries(cr.headings).flatMap(([, hs]) =>
          hs.filter(h => { const norm = h.toLowerCase().trim(); if (seen.has(norm)) return false; seen.add(norm); return true })
        ).slice(0, 8)
        return `  Keyword: "${cr.keyword}" — competitor headings: ${deduped.map(h => `• ${h}`).join('; ')}`
      }).join('\n')
    : ''

  const guidelinesText = (clientSettings?.topic_guidelines as string | null | undefined)?.trim()
    ? `\nContent Guidelines & Restrictions (strictly follow — never generate topics that violate these):\n${clientSettings!.topic_guidelines}`
    : ''

  // ── Silo context (topical authority hub + cluster strategy) ───────────────
  let siloPromptBlock = ''
  let siloName: string | null = null
  let siloContentType: string | null = null
  if (opts?.siloId) {
    const { data: silo, error: siloErr } = await db
      .from('content_silos')
      .select('id, name, hub_page_url, hub_page_title, central_entity, description, target_keyword, cluster_keywords, target_exists, content_type')
      .eq('id', opts.siloId)
      .maybeSingle()
    if (siloErr) console.error('[generateTopics] silo fetch error:', siloErr.message)

    if (silo) {
      siloName        = silo.name as string
      siloContentType = (silo.content_type as string | null) ?? null

      // Fetch existing cluster posts in this silo to prevent duplicate intents
      const { data: existingClusters } = await db
        .from('content_posts')
        .select('title, target_keyword')
        .eq('silo_id', opts.siloId)
        .in('status', ['for_review', 'draft_saved', 'published', 'approved'])
        .limit(30)

      const existingClusterText = (existingClusters ?? [])
        .filter((c: { title: string | null; target_keyword: string | null }) => c.title)
        .map((c: { title: string | null; target_keyword: string | null }) => `  - "${c.title}" — keyword: ${c.target_keyword ?? 'n/a'}`)
        .join('\n')

      // Hub-first block: when hub page doesn't exist yet, inject as FIRST topic instruction
      const hubFirstBlock = (silo.target_exists === false && silo.target_keyword)
        ? `
CRITICAL — HUB PAGE PRIORITY:
The hub/pillar page does not exist yet. The FIRST topic in your response MUST target:
  keyword: "${silo.target_keyword}"
  This topic will be used to create the hub page before any cluster articles.
  Make it a comprehensive, high-authority page — the definitive resource for this entity.
`
        : ''

      // Cluster keyword seeding: inject planned keywords the AI should prioritize
      type ClusterKw = { id?: string; keyword: string; title?: string | null; status: string; priority?: number }
      const plannedKws = ((silo.cluster_keywords ?? []) as ClusterKw[])
        .filter(k => k.status === 'planned')
        .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
        .slice(0, 12)

      const clusterSeedText = plannedKws.length > 0
        ? `\nDefined cluster keywords not yet covered (PRIORITIZE topics from this list — generate topics targeting these keywords):\n${plannedKws.map(k => `  - "${k.keyword}"${k.title ? ` (suggested title: "${k.title}")` : ''}`).join('\n')}`
        : ''

      siloPromptBlock = `
${hubFirstBlock}TOPICAL SILO — HUB + CLUSTER STRATEGY:
Hub page: "${silo.hub_page_title ?? silo.name}" at ${silo.hub_page_url ?? '(URL not yet set)'}
Central entity: ${silo.central_entity ?? silo.name}${silo.description ? `\nContext: ${silo.description}` : ''}
${existingClusterText ? `\nAlready-published cluster articles in this silo (DO NOT duplicate these intents):\n${existingClusterText}` : ''}
${clusterSeedText}

SILO RULES (override any conflicting instructions above):
1. Every topic must be a distinct subtopic or attribute of the central entity.
2. Every article generated from these topics MUST link back to the hub page as a mandatory internal link.
3. No two topics may target the same search intent — zero cannibalization within the silo.
4. Prioritize subtopics closest to revenue (transactional/commercial intent first within the silo).
5. Think: what questions does a searcher ask BEFORE contacting the business? Those cluster topics funnel authority to the hub.`
    }
  }

  const effectiveContentType = siloContentType ?? opts?.contentType ?? 'blog'

  const contentTypeLabel = effectiveContentType === 'service_page'
    ? 'service landing page'
    : effectiveContentType === 'regular_page'
      ? 'evergreen page'
      : 'blog post'

  const contentTypeInstructions = effectiveContentType === 'service_page'
    ? `Each topic must become a dedicated SERVICE LANDING PAGE — not a blog article. Focus on commercial/transactional intent: pages that a visitor lands on when they are actively looking to hire or buy. Structure topics around individual services, service variants, or service+location combinations. Every page must have a clear CTA and conversion goal.`
    : effectiveContentType === 'regular_page'
      ? `Each topic must become an EVERGREEN INFORMATIONAL PAGE — not a blog article. Focus on foundational content that stays relevant year-round: About Us, FAQ, Resources, How We Work, Process, Testimonials concept pages, comparison guides, or educational reference pages. These pages should support navigation and build topical authority without time-sensitive angles.`
      : `Each topic must become a BLOG POST — an article-format piece targeting informational, educational, or comparison search intent. Blog posts are dated and can be time-sensitive. Focus on questions, how-tos, comparisons, and long-tail informational queries.`

  const systemPrompt = `You are an SEO content strategist for ${settings.agency_name ?? 'a digital agency'}.
Suggest ${contentTypeLabel} topic ideas for a client based on their business context and Google Search Console data.

${contentTypeInstructions}

CLUSTERING RULE: Before finalising your list, check if any two topics target the same search intent. If two proposed topics would compete for the same searcher (e.g. "how to finance a car" and "best auto financing options"), COMBINE them into one stronger comprehensive article and return only one. Each topic must target a clearly distinct audience need. This prevents keyword cannibalization where Google gets confused about which page to rank.

Strictly follow any Content Guidelines & Restrictions provided. Never generate topics, target keywords, or angles the client has explicitly asked to avoid.

IMPORTANT: When GSC data lists an "Existing page to support", the suggested topic MUST be a cluster or support article — NOT a new primary page competing with that URL. Target a long-tail or adjacent angle designed to internally link to the existing core page.
${siloPromptBlock ? `\n${siloPromptBlock.trim()}\n` : ''}
Return ONLY a JSON array of exactly ${count} objects:
[
  {
    "topic": "Full blog post title",
    "target_keyword": "primary keyword phrase",
    "search_intent": "informational | commercial | local_service | comparison | cost_pricing | how_to | faq | emergency",
    "secondary_keywords": "comma-separated list of 3–5 LSI/semantic keyword variations",
    "keyword_opportunity": "3–5 sentences: Which specific GSC signal drove this pick (name the page, position, and monthly impressions). Why this exact keyword is the right primary target. Estimated volume and difficulty context. Any seasonal or trending component to the opportunity.",
    "ranking_strategy": "3–5 sentences: Which competitor gaps this article fills. What unique angle or depth will outperform existing page-1 results. Specific linking strategy (which existing site page this supports and why). Why this approach wins for this client over generic competitors.",
    "audience_intent": "2–3 sentences: Who specifically is searching this (describe the person, their situation, and what they are trying to decide or do). What stage of the buyer/research journey they are in. What outcome they need from the content.",
    "why_now": "2–3 sentences: Specific seasonal or trending timing reason with data context if available. Competitor activity or content gap timing. Why generating this topic now versus later maximises the ranking window.",
    "competition_level": "Low/Medium/High — 1-sentence reasoning citing what makes it that level",
    "cluster_group": "kebab-case cluster label (e.g. auto-financing, lease-vs-buy)"
  }
]
No text outside the JSON array.`

  const userPrompt = `Client: ${clientName}
${contextLines.join('\n')}${eeatText}
${siloName ? `\nTarget silo: "${siloName}" — all topics must fit within this topical cluster.` : ''}
${gscGrowthText}
${gscQuickWinsText}
${gscCtrText}
${competitorText}
${gscTopText}
${sitemapText}
${avoidText ? `\nAlready covered — DO NOT suggest these again:\n${avoidText}` : ''}
${guidelinesText}

Suggest ${count} high-impact ${contentTypeLabel} topics${siloName ? ` for the "${siloName}" silo` : ''} that will improve this client's organic search performance.`

  const provider = settings.ai_provider || 'anthropic'
  const model    = settings.ai_model    || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o')
  const apiKey   = settings.ai_api_key

  let rawText = ''
  try {
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 8192, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
      })
      if (!res.ok) throw new Error(`AI API error: ${await res.text()}`)
      const data = await res.json()
      const tb   = data.content?.find((b: Record<string, unknown>) => b.type === 'text')
      rawText    = tb?.text || ''
    } else {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }),
      })
      if (!res.ok) throw new Error(`AI API error: ${await res.text()}`)
      const data = await res.json()
      rawText    = data.choices?.[0]?.message?.content || ''
    }
  } catch (err) {
    return { topics: [], clientName, count: 0, error: String(err) }
  }

  // ── Parse ──────────────────────────────────────────────────────────────────
  let topics: TopicIdea[] = []
  try {
    const stripped  = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const jsonMatch = stripped.match(/\[[\s\S]*\]/)
    if (jsonMatch) topics = JSON.parse(jsonMatch[0]) as TopicIdea[]
    else console.error('[generateTopics] no JSON array found in AI response, rawText length:', rawText.length)
  } catch (parseErr) {
    console.error('[generateTopics] JSON parse error:', parseErr, 'rawText snippet:', rawText.slice(0, 200))
    return { topics: [], clientName, count: 0, error: 'Failed to parse AI response' }
  }

  if (!topics.length) {
    console.error('[generateTopics] AI returned empty topics array, rawText length:', rawText.length)
    return { topics: [], clientName, count: 0, error: 'No topics returned from AI' }
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  const rows = topics.map(t => ({
    client_id:            clientId,
    topic:                t.topic,
    target_keyword:       t.target_keyword,
    search_intent:        t.search_intent       ?? null,
    secondary_keywords:   t.secondary_keywords  ?? null,
    rationale:            [t.keyword_opportunity, t.ranking_strategy, t.audience_intent, t.why_now, t.competition_level].filter(Boolean).join(' | '),
    keyword_opportunity:  t.keyword_opportunity ?? null,
    ranking_strategy:     t.ranking_strategy    ?? null,
    audience_intent:      t.audience_intent     ?? null,
    why_now:              t.why_now             ?? null,
    competition_level:    t.competition_level   ?? null,
    cluster_group:        t.cluster_group       ?? (siloName ? siloName.toLowerCase().replace(/\s+/g, '-') : null),
    competitors_researched: t.target_keyword ? (competitorMap.get(t.target_keyword) ?? null) : null,
    // Only include silo_id when set — column requires migration 149 (content_silos)
    ...(opts?.siloId ? { silo_id: opts.siloId } : {}),
    content_type:         effectiveContentType,
    status:               'pending',
    target_publish_date:  targetPublishDate ?? null,
  }))

  const { data: saved, error: insertError } = await db
    .from('content_topics')
    .insert(rows)
    .select()

  if (insertError) {
    console.error('[generateTopics] insert error:', insertError.message, insertError.details, insertError.hint)
    return { topics: [], clientName, count: 0, error: insertError.message }
  }
  console.log(`[generateTopics] inserted ${(saved ?? []).length} topics for client ${clientId}`)

  const savedTopics = ((saved ?? []) as Array<{ id: string; topic: string; target_keyword: string | null; keyword_opportunity: string | null }>)
    .map(r => ({
      id:                  r.id,
      topic:               r.topic,
      target_keyword:      r.target_keyword ?? null,
      target_publish_date: targetPublishDate ?? null,
      keyword_opportunity: r.keyword_opportunity ?? null,
    }))

  // ── Email notification (skipped when called from the cron batch flow) ───────
  if (!opts?.suppressEmail) {
    const notifEmail = settings.notification_email as string | null
    if (notifEmail && (settings.notify_topics_created || settings.notify_topic_ready)) {
      const agencyName = settings.agency_name ?? 'Agency Dashboard'
      try {
        const appUrl     = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
        const clientLink = `${appUrl}/admin/clients/${clientId}?tab=content&subtab=schedule`
        await sendEmail({
          to:      notifEmail,
          subject: `${agencyName} | ${clientName} — Topics Ready for Review`,
          html:    buildTopicsEmail({ agencyName, clientName, topics: savedTopics, clientLink }),
        })
      } catch (emailErr) {
        console.error('[generateTopics] email error:', emailErr)
      }
    }
  }

  return { topics: savedTopics, clientName, count: savedTopics.length }
}
