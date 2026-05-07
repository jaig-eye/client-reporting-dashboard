// POST /api/admin/content/topics/[id]/brief
// Generates an SEO brief for an approved topic and stores it in content_topics.seo_brief.
// Called by the content-topics cron and can be triggered manually from the UI.

import { NextRequest, NextResponse } from 'next/server'
import { cookies }                   from 'next/headers'
import { createAdminClient }         from '@/lib/supabase/server'
import { isAdminAuthed }             from '@/lib/auth'
import type { SeoBrief }             from '@/lib/content/types'

export const maxDuration = 120

type Params = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  const cookieStore = await cookies()
  const authHeader  = request.headers.get('authorization')
  const isCron      = authHeader === `Bearer ${process.env.CRON_SECRET}`
  if (!isCron && !isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: topicId } = await params
  const db = createAdminClient()

  // ── Load topic + client settings ──────────────────────────────────────────
  const { data: topic } = await db
    .from('content_topics')
    .select('*, clients(name)')
    .eq('id', topicId)
    .single()

  if (!topic) return NextResponse.json({ error: 'Topic not found' }, { status: 404 })
  if (topic.status !== 'approved' && topic.status !== 'scheduled') {
    return NextResponse.json({ error: 'Topic must be approved before generating a brief' }, { status: 400 })
  }

  const [settingsRes, clientSettingsRes, existingTopicsRes] = await Promise.all([
    db.from('agency_settings')
      .select('ai_provider, ai_model, ai_api_key, agency_name')
      .single(),
    db.from('content_settings')
      .select('business_background, services, target_audience, geographic_focus, brand_voice, phone_number, cta_list, sitemap_urls, sitemap_url, eeat_data')
      .eq('client_id', topic.client_id)
      .maybeSingle(),
    // Last 50 non-rejected topics for cannibalization check
    db.from('content_topics')
      .select('topic, target_keyword, status')
      .eq('client_id', topic.client_id)
      .not('status', 'eq', 'rejected')
      .not('id', 'eq', topicId)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  if (!settingsRes.data?.ai_api_key) {
    return NextResponse.json({ error: 'AI not configured' }, { status: 400 })
  }

  const agencySettings = settingsRes.data
  const cs             = clientSettingsRes.data as Record<string, unknown> | null
  const clientName     = (topic.clients as { name: string } | null)?.name ?? 'this client'

  // ── Sitemap pages for internal link planning ───────────────────────────────
  const sitemapUrls: string[] = (() => {
    const urls = cs?.sitemap_urls
    if (Array.isArray(urls) && urls.length > 0) return urls as string[]
    if (cs?.sitemap_url) return [String(cs.sitemap_url)]
    return []
  })()

  let sitemapSample: string[] = []
  if (sitemapUrls.length > 0) {
    try {
      const res = await fetch(sitemapUrls[0], { signal: AbortSignal.timeout(4000), headers: { 'User-Agent': 'SEOBot/1.0' } })
      if (res.ok) {
        const xml   = await res.text()
        const urls2 = Array.from(xml.matchAll(/<loc>\s*(https?:\/\/[^\s<]+)\s*<\/loc>/gi)).map(m => m[1].trim()).filter(u => !u.endsWith('.xml')).slice(0, 30)
        sitemapSample = urls2
      }
    } catch { /* ignore */ }
  }

  // ── E-E-A-T context ────────────────────────────────────────────────────────
  const eeat = cs?.eeat_data as Record<string, unknown> | null
  const eeatLines: string[] = []
  if (eeat) {
    if (eeat.years_in_business) eeatLines.push(`Years in business: ${eeat.years_in_business}`)
    if (eeat.licenses)          eeatLines.push(`Licenses: ${eeat.licenses}`)
    if (eeat.insurance)         eeatLines.push(`Insurance: ${eeat.insurance}`)
    if (eeat.review_count)      eeatLines.push(`Reviews: ${eeat.review_count}`)
    if (eeat.guarantees)        eeatLines.push(`Guarantees: ${eeat.guarantees}`)
    if (eeat.awards)            eeatLines.push(`Awards: ${eeat.awards}`)
  }

  // ── Existing topic keywords for cannibalization check ─────────────────────
  const existingKeywords = (existingTopicsRes.data ?? [])
    .map(t => t.target_keyword ?? t.topic)
    .filter(Boolean)
    .slice(0, 40)
    .join(', ')

  // ── Build prompts ──────────────────────────────────────────────────────────
  const systemPrompt = `You are an expert SEO content strategist for ${agencySettings.agency_name ?? 'a digital marketing agency'}.
Produce a structured SEO brief for a single blog post topic. The brief will be used to guide AI content generation.
Return ONLY a valid JSON object matching the SeoBrief schema. No text outside the JSON.`

  const userPrompt = `Client: ${clientName}
Topic: ${topic.topic}
Primary keyword: ${topic.target_keyword ?? 'to be determined'}
Search intent: ${topic.search_intent ?? 'informational'}

Business context:
${cs?.business_background ? `Background: ${cs.business_background}` : ''}
${cs?.services ? `Services: ${cs.services}` : ''}
${cs?.target_audience ? `Audience: ${cs.target_audience}` : ''}
${cs?.geographic_focus ? `Geography: ${cs.geographic_focus}` : ''}
${cs?.brand_voice ? `Voice: ${cs.brand_voice}` : ''}
${cs?.phone_number ? `Phone: ${cs.phone_number}` : ''}
${cs?.cta_list ? `CTA options:\n${cs.cta_list}` : ''}
${eeatLines.length ? `\nTrust signals:\n${eeatLines.join('\n')}` : ''}

${sitemapSample.length ? `\nExisting site pages (use for internal link targets):\n${sitemapSample.join('\n')}` : ''}

${existingKeywords ? `\nAlready covered keywords (check for cannibalization):\n${existingKeywords}` : ''}

Produce a SeoBrief JSON object with these exact keys:
{
  "primary_keyword": "exact primary keyword phrase",
  "secondary_keywords": ["array", "of", "3-5", "lsi keywords"],
  "search_intent": "informational | commercial | local_service | comparison | cost_pricing | how_to | faq | emergency",
  "funnel_stage": "awareness | consideration | decision",
  "target_audience": "who is searching this and why",
  "suggested_slug": "url-slug-no-spaces",
  "title_tag": "SEO title tag (50-60 chars)",
  "alternative_titles": ["Alternative title 1", "Alternative title 2"],
  "meta_description": "Meta description 140-155 chars",
  "h1": "H1 heading for the article",
  "h2_outline": ["H2 section 1", "H2 section 2", "H2 section 3", "H2 section 4", "H2 section 5"],
  "internal_link_targets": ["url1", "url2", "url3"],
  "external_source_types": ["industry stat", "local regulation", etc],
  "local_seo_angle": "city/region relevance or empty string",
  "faq_opportunities": ["Question 1?", "Question 2?", "Question 3?"],
  "schema_type": "BlogPosting | FAQPage | HowTo | Service | LocalBusiness | null",
  "content_gap_notes": "what competitors miss that this post should cover",
  "unique_angle": "what makes this post stand out",
  "cta_text": "the most appropriate CTA for this post's intent",
  "expert_review_flag": false,
  "expert_review_reason": null,
  "cannibalization_warning": null or "brief note if this might compete with existing content",
  "image_concept": "description of ideal featured image",
  "alt_text": "alt text for the featured image",
  "word_count_target": 1500
}`

  // ── AI call ────────────────────────────────────────────────────────────────
  const provider = agencySettings.ai_provider || 'anthropic'
  const model    = agencySettings.ai_model    || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o')
  const apiKey   = agencySettings.ai_api_key

  let rawText = ''
  try {
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 1500, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
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
    console.error('[brief] AI call failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }

  // ── Parse brief ────────────────────────────────────────────────────────────
  let brief: SeoBrief
  try {
    const stripped  = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const jsonMatch = stripped.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON object found in response')
    brief = JSON.parse(jsonMatch[0]) as SeoBrief
  } catch (err) {
    console.error('[brief] parse failed:', err, rawText.slice(0, 200))
    return NextResponse.json({ error: 'Failed to parse SEO brief from AI response' }, { status: 500 })
  }

  // ── Store brief ────────────────────────────────────────────────────────────
  const { error: updateError } = await db
    .from('content_topics')
    .update({ seo_brief: brief })
    .eq('id', topicId)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ brief })
}
