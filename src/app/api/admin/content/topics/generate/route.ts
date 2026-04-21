// POST /api/admin/content/topics/generate
// Generates topic ideas for a client using GSC data + AI.
// Saves them to content_topics with status='pending' and sends email notification.
//
// Body: { client_id, count?, target_publish_date? }

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import { sendEmail } from '@/lib/email'

interface TopicIdea {
  topic:          string
  rationale:      string
  target_keyword: string
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

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as { client_id: string; count?: number; target_publish_date?: string }
  const { client_id, count = 5, target_publish_date } = body

  if (!client_id) {
    return NextResponse.json({ error: 'client_id required' }, { status: 400 })
  }

  const db = createAdminClient()
  const windowStart = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10)

  // ── Fetch all required data in parallel ───────────────────────────────────
  const [
    settingsRes,
    clientRes,
    clientSettingsRes,
    existingTopicsRes,
    existingPostsRes,
    gscRawRes,
  ] = await Promise.all([
    db.from('agency_settings')
      .select('ai_provider, ai_model, ai_api_key, agency_name, notification_email, notify_topics_created')
      .single(),
    db.from('clients').select('id, name').eq('id', client_id).single(),
    db.from('content_settings')
      .select('business_background, services, target_audience, geographic_focus, brand_voice, phone_number, sitemap_url, sitemap_urls')
      .eq('client_id', client_id)
      .maybeSingle(),
    // Non-rejected topics (all time) — broad dedup
    db.from('content_topics')
      .select('topic, target_keyword')
      .eq('client_id', client_id)
      .not('status', 'eq', 'rejected'),
    // Recent posts (last 90 days)
    db.from('content_posts')
      .select('title, focus_topic, target_keyword')
      .eq('client_id', client_id)
      .gte('generated_at', new Date(Date.now() - 90 * 86_400_000).toISOString())
      .order('generated_at', { ascending: false })
      .limit(50),
    // GSC 28-day window for topic context
    db.from('gsc_metrics')
      .select('page, query, clicks, impressions, position, ctr')
      .eq('client_id', client_id)
      .gte('date', windowStart)
      .not('page', 'ilike', '%?%')
      .not('query', 'eq', ''),
  ])

  if (!settingsRes.data?.ai_api_key) {
    return NextResponse.json({ error: 'AI not configured. Add an API key in Agency Settings.' }, { status: 400 })
  }

  const settings       = settingsRes.data
  const client         = clientRes.data
  const clientSettings = clientSettingsRes.data as Record<string, unknown> | null
  const clientName     = client?.name ?? 'this client'

  // ── Aggregate GSC 28-day data ──────────────────────────────────────────────
  type GscAgg = { totalClicks: number; totalImpr: number; weightedPos: number; weightedCtr: number; count: number }
  const gscMap = new Map<string, GscAgg>() // key = "page||query"

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
      gscMap.set(key, {
        totalClicks:  r.clicks ?? 0,
        totalImpr:    impr,
        weightedPos:  r.position ?? 0,
        weightedCtr:  r.ctr ?? 0,
        count:        1,
      })
    }
  }

  // Top pages (by clicks) — reinforce with internal links
  const topPages = Array.from(gscMap.entries())
    .map(([k, v]) => {
      const [page, query] = k.split('||')
      return { page, query, ...v }
    })
    .sort((a, b) => b.totalClicks - a.totalClicks)
    .slice(0, 10)

  // Growth targets (pos 10–20, reasonable impressions) — best for new articles
  const growthTargets = Array.from(gscMap.entries())
    .map(([k, v]) => {
      const [page, query] = k.split('||')
      return { page, query, ...v }
    })
    .filter(r => r.weightedPos > 9 && r.weightedPos <= 20 && r.totalImpr > 10)
    .sort((a, b) => b.totalImpr - a.totalImpr)
    .slice(0, 15)

  // ── Multi-sitemap pages ────────────────────────────────────────────────────
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

  // ── Build avoid list ───────────────────────────────────────────────────────
  const existingTopics = (existingTopicsRes.data ?? []) as { topic: string; target_keyword?: string }[]
  const existingPosts  = (existingPostsRes.data ?? []) as { title?: string; focus_topic?: string; target_keyword?: string }[]

  const avoidSet = new Set<string>()
  existingTopics.forEach(t => { if (t.topic) avoidSet.add(t.topic); if (t.target_keyword) avoidSet.add(t.target_keyword) })
  existingPosts.forEach(p => {
    if (p.focus_topic) avoidSet.add(p.focus_topic)
    if (p.title) avoidSet.add(p.title)
    if (p.target_keyword) avoidSet.add(p.target_keyword)
  })
  const avoidText = Array.from(avoidSet).slice(0, 50).join(', ')

  // ── Build prompt context ───────────────────────────────────────────────────
  const contextLines: string[] = []
  if (clientSettings?.business_background) contextLines.push(`Business: ${clientSettings.business_background}`)
  if (clientSettings?.services)            contextLines.push(`Services: ${clientSettings.services}`)
  if (clientSettings?.target_audience)     contextLines.push(`Target audience: ${clientSettings.target_audience}`)
  if (clientSettings?.geographic_focus)    contextLines.push(`Geographic focus: ${clientSettings.geographic_focus}`)
  if (clientSettings?.brand_voice)         contextLines.push(`Brand voice: ${clientSettings.brand_voice}`)

  const gscTopText = topPages.length > 0
    ? `\nTop-performing pages — reinforce with internal links from new content:\n${topPages.slice(0, 8).map(p => `  - "${p.query}" → ${p.page} (${p.totalClicks} clicks, pos ${p.weightedPos.toFixed(1)})`).join('\n')}`
    : ''

  const gscGrowthText = growthTargets.length > 0
    ? `\nPage-2 opportunities (pos 10–20) — site has relevance but no focused page yet. PRIORITISE topics that create a dedicated article for these queries:\n${growthTargets.slice(0, 12).map(p => `  - "${p.query}" → ${p.page} (${p.totalImpr} impr, pos ${p.weightedPos.toFixed(1)})`).join('\n')}`
    : ''

  const sitemapText = sitemapPages.length > 0
    ? `\nExisting site pages (for internal link planning):\n${sitemapPages.slice(0, 30).join('\n')}`
    : ''

  const systemPrompt = `You are an SEO content strategist for ${settings.agency_name ?? 'a digital agency'}.
Suggest blog post topic ideas for a client based on their business context and Google Search Console data.

For each topic provide:
- A clear, specific blog post title
- A brief rationale (2–3 sentences): which GSC gap it addresses, what keyword it targets, why it will rank
- The primary target keyword phrase

Return ONLY a JSON array of exactly ${count} objects:
[
  {
    "topic": "Full blog post title",
    "rationale": "2–3 sentences on the GSC opportunity and ranking strategy",
    "target_keyword": "primary keyword phrase"
  }
]
No text outside the JSON array.`

  const userPrompt = `Client: ${clientName}
${contextLines.join('\n')}
${gscGrowthText}
${gscTopText}
${sitemapText}
${avoidText ? `\nAlready covered — DO NOT suggest these again:\n${avoidText}` : ''}

Suggest ${count} high-impact blog post topics that will improve this client's organic search performance.`

  const provider = settings.ai_provider || 'anthropic'
  const model    = settings.ai_model || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o')
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
      const tb = data.content?.find((b: Record<string, unknown>) => b.type === 'text')
      rawText = tb?.text || ''
    } else {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }),
      })
      if (!res.ok) throw new Error(`AI API error: ${await res.text()}`)
      const data = await res.json()
      rawText = data.choices?.[0]?.message?.content || ''
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }

  // ── Parse AI response ──────────────────────────────────────────────────────
  let topics: TopicIdea[] = []
  try {
    const stripped  = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const jsonMatch = stripped.match(/\[[\s\S]*\]/)
    if (jsonMatch) topics = JSON.parse(jsonMatch[0]) as TopicIdea[]
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response', raw: rawText }, { status: 500 })
  }

  if (!topics.length) {
    return NextResponse.json({ error: 'No topics returned', raw: rawText }, { status: 500 })
  }

  // ── Save to DB ─────────────────────────────────────────────────────────────
  const rows = topics.map(t => ({
    client_id,
    topic:               t.topic,
    rationale:           t.rationale,
    target_keyword:      t.target_keyword,
    status:              'pending',
    target_publish_date: target_publish_date ?? null,
  }))

  const { data: saved, error: insertError } = await db
    .from('content_topics')
    .insert(rows)
    .select()

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // ── Send email notification ────────────────────────────────────────────────
  const notifEmail = settings.notification_email as string | null
  if (notifEmail && settings.notify_topics_created) {
    const agencyName = settings.agency_name ?? 'Agency Dashboard'
    try {
      await sendEmail({
        to:      notifEmail,
        subject: `[${agencyName}] Topics ready for review — ${clientName}`,
        html: `<p><strong>${topics.length} new topic idea${topics.length !== 1 ? 's' : ''}</strong> have been generated for <strong>${clientName}</strong> and are waiting for your review.</p>
               <ul>${topics.map(t => `<li><strong>${t.topic}</strong><br/><small>${t.rationale}</small></li>`).join('')}</ul>
               <p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? ''}/admin/content?tab=queue">Review Topics →</a></p>`,
      })
    } catch (emailErr) {
      console.error('[topics/generate] email error:', emailErr)
    }
  }

  return NextResponse.json({ topics: saved ?? [], count: (saved ?? []).length })
}
