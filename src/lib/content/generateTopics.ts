// Shared topic generation logic.
// Extracted from /api/admin/content/topics/generate/route.ts so both the
// per-client API route and the bulk calendar/generate route use identical logic.

import { createAdminClient } from '@/lib/supabase/server'
import { sendEmail }         from '@/lib/email'

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

export interface GenerateTopicsResult {
  topics:     Array<{ id: string }>
  clientName: string
  count:      number
  error?:     string
}

export async function generateTopicsForClient(
  db:       ReturnType<typeof createAdminClient>,
  clientId: string,
  count:    number,
  targetPublishDate?: string,
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
      .select('ai_provider, ai_model, ai_api_key, agency_name, notification_email, notify_topics_created, notify_topic_ready')
      .single(),
    db.from('clients').select('id, name').eq('id', clientId).single(),
    db.from('content_settings')
      .select('business_background, services, target_audience, geographic_focus, brand_voice, phone_number, sitemap_url, sitemap_urls, eeat_data')
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

  // ── Sitemap pages ──────────────────────────────────────────────────────────
  const sitemapUrls: string[] = (() => {
    const urls = clientSettings?.sitemap_urls
    if (Array.isArray(urls) && urls.length > 0) return urls as string[]
    if (clientSettings?.sitemap_url) return [String(clientSettings.sitemap_url)]
    return []
  })()

  let sitemapPages: string[] = []
  if (sitemapUrls.length > 0) {
    const allPages = (await Promise.all(sitemapUrls.map(fetchSitemapPages))).flat()
    sitemapPages   = Array.from(new Set(allPages)).slice(0, 60)
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
    ? `\nTop-performing pages:\n${topPages.slice(0, 8).map(p => `  - "${p.query}" → ${p.page} (${p.totalClicks} clicks, pos ${p.weightedPos.toFixed(1)})`).join('\n')}`
    : ''

  const gscGrowthText = growthTargets.length > 0
    ? `\nPage-2 opportunities (pos 10–20) — PRIORITISE topics targeting these queries:\n${growthTargets.slice(0, 12).map(p => `  - "${p.query}" → ${p.page} (${p.totalImpr} impr, pos ${p.weightedPos.toFixed(1)})`).join('\n')}`
    : ''

  const sitemapText = sitemapPages.length > 0
    ? `\nExisting site pages (for internal link planning):\n${sitemapPages.slice(0, 30).join('\n')}`
    : ''

  const systemPrompt = `You are an SEO content strategist for ${settings.agency_name ?? 'a digital agency'}.
Suggest blog post topic ideas for a client based on their business context and Google Search Console data.

Return ONLY a JSON array of exactly ${count} objects:
[
  {
    "topic": "Full blog post title",
    "target_keyword": "primary keyword phrase",
    "search_intent": "informational | commercial | local_service | comparison | cost_pricing | how_to | faq | emergency",
    "secondary_keywords": "comma-separated list of 3–5 LSI/semantic keyword variations",
    "keyword_opportunity": "'keyword phrase' — X/mo, pos Y",
    "ranking_strategy": "How this article will outrank existing results (1–2 sentences)",
    "audience_intent": "What the searcher needs or wants (1 sentence)",
    "why_now": "Seasonal, competitive, or trending timing reason (1 sentence)",
    "competition_level": "Low/Medium/High — brief 1-line reasoning"
  }
]
No text outside the JSON array.`

  const userPrompt = `Client: ${clientName}
${contextLines.join('\n')}${eeatText}
${gscGrowthText}
${gscTopText}
${sitemapText}
${avoidText ? `\nAlready covered — DO NOT suggest these again:\n${avoidText}` : ''}

Suggest ${count} high-impact blog post topics that will improve this client's organic search performance.`

  const provider = settings.ai_provider || 'anthropic'
  const model    = settings.ai_model    || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o')
  const apiKey   = settings.ai_api_key

  let rawText = ''
  try {
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 2048, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
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
  } catch {
    return { topics: [], clientName, count: 0, error: 'Failed to parse AI response' }
  }

  if (!topics.length) {
    return { topics: [], clientName, count: 0, error: 'No topics returned from AI' }
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  const rows = topics.map(t => ({
    client_id: clientId,
    topic:               t.topic,
    target_keyword:      t.target_keyword,
    search_intent:       t.search_intent       ?? null,
    secondary_keywords:  t.secondary_keywords  ?? null,
    rationale:           [t.keyword_opportunity, t.ranking_strategy, t.audience_intent, t.why_now, t.competition_level].filter(Boolean).join(' | '),
    keyword_opportunity: t.keyword_opportunity ?? null,
    ranking_strategy:    t.ranking_strategy    ?? null,
    audience_intent:     t.audience_intent     ?? null,
    why_now:             t.why_now             ?? null,
    competition_level:   t.competition_level   ?? null,
    status:              'pending',
    target_publish_date: targetPublishDate ?? null,
  }))

  const { data: saved, error: insertError } = await db
    .from('content_topics')
    .insert(rows)
    .select()

  if (insertError) {
    return { topics: [], clientName, count: 0, error: insertError.message }
  }

  // ── Email notification ─────────────────────────────────────────────────────
  const notifEmail = settings.notification_email as string | null
  if (notifEmail && (settings.notify_topics_created || settings.notify_topic_ready)) {
    const agencyName = settings.agency_name ?? 'Agency Dashboard'
    try {
      const firstTopicId = (saved as { id: string }[] | null)?.[0]?.id ?? ''
      const appUrl       = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
      await sendEmail({
        to:      notifEmail,
        subject: `[${agencyName}] Topics ready for review — ${clientName}`,
        html: `<p><strong>${topics.length} new topic idea${topics.length !== 1 ? 's' : ''}</strong> have been generated for <strong>${clientName}</strong> and are waiting for your review.</p>
               <ul>${topics.map(t => `<li><strong>${t.topic}</strong><br/><small>${[t.keyword_opportunity, t.ranking_strategy].filter(Boolean).join(' · ')}</small></li>`).join('')}</ul>
               <p><a href="${appUrl}/admin/content${firstTopicId ? `?highlight=${firstTopicId}` : ''}">Review Topics →</a></p>`,
      })
    } catch (emailErr) {
      console.error('[generateTopics] email error:', emailErr)
    }
  }

  const savedTopics = (saved ?? []) as { id: string }[]
  return { topics: savedTopics, clientName, count: savedTopics.length }
}
