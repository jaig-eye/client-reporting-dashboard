// POST /api/admin/content/topics/generate
// Generates topic ideas for a client using GSC data + AI.
// Saves them to content_topics with status='pending' and sends email notification.
//
// Body: { client_id, count? }

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import { sendEmail } from '@/lib/email'

interface TopicIdea {
  topic:           string
  rationale:       string
  target_keyword:  string
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as { client_id: string; count?: number }
  const { client_id, count = 5 } = body

  if (!client_id) {
    return NextResponse.json({ error: 'client_id required' }, { status: 400 })
  }

  const db = createAdminClient()

  // ── Fetch all required data in parallel ───────────────────────────────────
  const [
    settingsRes,
    clientRes,
    clientSettingsRes,
    existingTopicsRes,
    existingPostsRes,
    gscTopRes,
    gscWeakRes,
  ] = await Promise.all([
    db.from('agency_settings')
      .select('ai_provider, ai_model, ai_api_key, agency_name, notification_email, notify_topics_created')
      .single(),
    db.from('clients').select('id, name').eq('id', client_id).single(),
    db.from('content_settings')
      .select('business_background, services, target_audience, geographic_focus, brand_voice, phone_number, sitemap_url')
      .eq('client_id', client_id)
      .maybeSingle(),
    // Existing topics to avoid repeats
    db.from('content_topics')
      .select('topic')
      .eq('client_id', client_id)
      .order('created_at', { ascending: false })
      .limit(30),
    // Existing posts to avoid repeats
    db.from('content_posts')
      .select('title, focus_topic, target_keyword')
      .eq('client_id', client_id)
      .order('generated_at', { ascending: false })
      .limit(30),
    // GSC top pages (high clicks — reinforce with internal links)
    db.from('gsc_metrics')
      .select('page, query, clicks, impressions, position, ctr')
      .eq('client_id', client_id)
      .order('clicks', { ascending: false })
      .limit(20),
    // GSC weak pages (impressions but low CTR / high position — good to improve)
    db.from('gsc_metrics')
      .select('page, query, clicks, impressions, position, ctr')
      .eq('client_id', client_id)
      .gt('impressions', 50)
      .gt('position', 5)
      .lt('ctr', 0.05)
      .order('impressions', { ascending: false })
      .limit(20),
  ])

  if (!settingsRes.data?.ai_api_key) {
    return NextResponse.json({ error: 'AI not configured. Add an API key in Agency Settings.' }, { status: 400 })
  }

  const settings       = settingsRes.data
  const client         = clientRes.data
  const clientSettings = clientSettingsRes.data as Record<string, string | null> | null
  const existingTopics = (existingTopicsRes.data ?? []).map((t: { topic: string }) => t.topic)
  const existingPosts  = (existingPostsRes.data ?? []) as { title?: string; focus_topic?: string; target_keyword?: string }[]
  const gscTop         = (gscTopRes.data ?? []) as { page: string; query: string; clicks: number; impressions: number; position: number; ctr: number }[]
  const gscWeak        = (gscWeakRes.data ?? []) as { page: string; query: string; clicks: number; impressions: number; position: number; ctr: number }[]

  const clientName = client?.name ?? 'this client'

  // ── Build prompt context ───────────────────────────────────────────────────
  const contextLines: string[] = []
  if (clientSettings?.business_background) contextLines.push(`Business: ${clientSettings.business_background}`)
  if (clientSettings?.services)            contextLines.push(`Services: ${clientSettings.services}`)
  if (clientSettings?.target_audience)     contextLines.push(`Target audience: ${clientSettings.target_audience}`)
  if (clientSettings?.geographic_focus)    contextLines.push(`Geographic focus: ${clientSettings.geographic_focus}`)
  if (clientSettings?.brand_voice)         contextLines.push(`Brand voice: ${clientSettings.brand_voice}`)

  const gscTopText = gscTop.length > 0
    ? `\nTop-performing GSC pages (reinforce with internal links from new content):\n${gscTop.slice(0, 10).map(p => `  - "${p.query}" → ${p.page} (${p.clicks} clicks, pos ${Number(p.position).toFixed(1)})`).join('\n')}`
    : ''

  const gscWeakText = gscWeak.length > 0
    ? `\nGSC pages with high impressions but weak CTR (good topics to write supporting content for):\n${gscWeak.slice(0, 10).map(p => `  - "${p.query}" → ${p.page} (${p.impressions} impressions, ${(p.ctr * 100).toFixed(1)}% CTR, pos ${Number(p.position).toFixed(1)})`).join('\n')}`
    : ''

  const avoidText = [...existingTopics, ...existingPosts.map(p => p.focus_topic || p.title || '').filter(Boolean)]
    .slice(0, 30)
    .join(', ')

  const systemPrompt = `You are an SEO content strategist for ${settings.agency_name ?? 'a digital agency'}.
You will suggest blog post topic ideas for a client based on their business context and Google Search Console data.

For each topic you suggest, provide:
- A clear, specific blog post title
- A brief rationale explaining: which GSC gap/opportunity it addresses, what keyword it targets, and why it will rank well
- The primary target keyword phrase

Return ONLY a JSON array of exactly ${count} objects with this structure:
[
  {
    "topic": "Full blog post title",
    "rationale": "2–3 sentences on the GSC opportunity and ranking strategy",
    "target_keyword": "primary keyword phrase"
  }
]
Do not include any text outside the JSON array.`

  const userPrompt = `Client: ${clientName}
${contextLines.length > 0 ? contextLines.join('\n') : ''}
${gscTopText}
${gscWeakText}
${avoidText ? `\nAlready covered topics — DO NOT suggest these:\n${avoidText}` : ''}

Suggest ${count} high-impact blog post topic ideas that will improve this client's organic search performance.`

  const provider = settings.ai_provider || 'anthropic'
  const model    = settings.ai_model || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o')
  const apiKey   = settings.ai_api_key

  let rawText = ''
  try {
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      })
      if (!res.ok) throw new Error(`AI API error: ${await res.text()}`)
      const data = await res.json()
      const textBlock = data.content?.find((b: Record<string, unknown>) => b.type === 'text')
      rawText = textBlock?.text || ''
    } else {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt },
          ],
        }),
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
    const stripped   = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const jsonMatch  = stripped.match(/\[[\s\S]*\]/)
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
    topic:          t.topic,
    rationale:      t.rationale,
    target_keyword: t.target_keyword,
    status:         'pending',
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
        html:    `<p><strong>${topics.length} new topic idea${topics.length !== 1 ? 's' : ''}</strong> have been generated for <strong>${clientName}</strong> and are waiting for your review.</p>
                  <ul>${topics.map(t => `<li><strong>${t.topic}</strong><br/><small>${t.rationale}</small></li>`).join('')}</ul>
                  <p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? ''}/admin/content?tab=topics">Review Topics →</a></p>`,
      })
    } catch (emailErr) {
      console.error('[topics/generate] email error:', emailErr)
      // Don't fail the whole request over email
    }
  }

  return NextResponse.json({ topics: saved ?? [], count: (saved ?? []).length })
}
