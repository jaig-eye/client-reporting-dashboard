import { NextRequest, NextResponse } from 'next/server'
import { cookies }           from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed }     from '@/lib/auth'

/**
 * POST /api/admin/content/schedule
 *
 * Triggered by Vercel Cron (or manually by an admin).
 * Loops through all clients with auto_generate = true and generates
 * new blog posts for each, saving them as 'pending' in content_posts.
 *
 * Auth: admin session cookie OR Vercel cron secret header (CRON_SECRET env var).
 */
export async function POST(request: NextRequest) {
  // Accept either admin session cookie or Vercel cron secret
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  const cookieStore = await cookies()
  const session     = cookieStore.get('admin_session')?.value

  const isCronAuth  = cronSecret && authHeader === `Bearer ${cronSecret}`
  const isAdminAuth = isAdminAuthed(session)

  if (!isCronAuth && !isAdminAuth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  // Load agency AI settings
  const { data: agencySettings } = await db
    .from('agency_settings')
    .select('ai_provider, ai_model, ai_api_key, agency_name')
    .single()

  if (!agencySettings?.ai_api_key) {
    return NextResponse.json({ error: 'AI not configured' }, { status: 400 })
  }

  // Load global content settings (client_id IS NULL)
  const { data: globalSettings } = await db
    .from('content_settings')
    .select('post_structure')
    .is('client_id', null)
    .maybeSingle()

  // Load all clients with auto_generate enabled
  const { data: clientSettingsRows } = await db
    .from('content_settings')
    .select('client_id, business_background, services, target_audience, geographic_focus, brand_voice, post_structure, posts_per_run, connection_id')
    .eq('auto_generate', true)
    .not('client_id', 'is', null)

  if (!clientSettingsRows?.length) {
    return NextResponse.json({ message: 'No clients with auto_generate enabled', generated: 0 })
  }

  const provider = agencySettings.ai_provider || 'anthropic'
  const model    = agencySettings.ai_model    || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o')
  const apiKey   = agencySettings.ai_api_key
  const agency   = agencySettings.agency_name || 'the agency'
  const globalStructure = (globalSettings as { post_structure?: string } | null)?.post_structure ?? ''

  let totalGenerated = 0
  const errors: string[] = []

  for (const cs of clientSettingsRows) {
    if (!cs.client_id) continue
    const postsPerRun = (cs.posts_per_run as number) || 1

    // Load existing post topics to avoid repeats
    const { data: existingPosts } = await db
      .from('content_posts')
      .select('focus_topic, title')
      .eq('client_id', cs.client_id)
      .order('generated_at', { ascending: false })
      .limit(50)

    const avoidList = ((existingPosts ?? []) as { focus_topic?: string; title?: string }[])
      .map(p => p.focus_topic || p.title)
      .filter(Boolean)
      .join('\n')

    // Build client context
    const contextLines: string[] = []
    if (cs.business_background) contextLines.push(`Business background: ${cs.business_background}`)
    if (cs.services)             contextLines.push(`Services: ${cs.services}`)
    if (cs.target_audience)      contextLines.push(`Target audience: ${cs.target_audience}`)
    if (cs.geographic_focus)     contextLines.push(`Geographic focus: ${cs.geographic_focus}`)
    if (cs.brand_voice)          contextLines.push(`Brand voice: ${cs.brand_voice}`)
    const structureNote = (cs.post_structure as string | null) ?? globalStructure
    if (structureNote)           contextLines.push(`\nPreferred post structure:\n${structureNote}`)
    const clientContext = contextLines.length > 0 ? `Client context:\n${contextLines.join('\n')}\n` : ''

    const systemPrompt = buildSystemPrompt(agency, clientContext, avoidList)

    for (let i = 0; i < postsPerRun; i++) {
      try {
        const userPrompt = `Write a new SEO blog post for this business. Choose a unique topic that hasn't been covered yet, based on their services and target audience. Make it genuinely useful and search-optimized.`

        let rawText = ''
        if (provider === 'anthropic') {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model, max_tokens: 4096, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
          })
          const data = await res.json()
          const tb = data.content?.find((b: Record<string, unknown>) => b.type === 'text')
          rawText = tb?.text || ''
        } else {
          const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }),
          })
          const data = await res.json()
          rawText = data.choices?.[0]?.message?.content || ''
        }

        const parsed = parseAIResponse(rawText)
        if (!parsed.title && !parsed.content) continue

        await db.from('content_posts').insert({
          client_id:       cs.client_id,
          connection_id:   cs.connection_id || null,
          status:          'pending',
          title:           parsed.title,
          content:         parsed.content,
          meta_description: parsed.metaDescription,
          slug:            parsed.slug,
          word_count:      wordCount(parsed.content),
          heading_count:   headingCount(parsed.content),
          internal_links:  internalLinks(parsed.content),
          generated_by:    'scheduled',
          ai_model:        model,
          prompt_used:     userPrompt,
        })

        totalGenerated++
      } catch (err) {
        errors.push(`client ${cs.client_id}: ${String(err)}`)
      }
    }
  }

  return NextResponse.json({ generated: totalGenerated, errors })
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function buildSystemPrompt(agency: string, clientContext: string, avoidTopics: string): string {
  return `You are a professional SEO content writer for ${agency}.
${clientContext ? `\n${clientContext}` : ''}
Write high-quality blog posts demonstrating E-E-A-T (Experience, Expertise, Authority, Trustworthiness).

SEO guidelines:
- Use the focus keyword in the H1, first paragraph, and 2–3 subheadings
- Include a compelling meta description (150–160 characters)
- Suggest a clean URL slug
- End with a clear call-to-action
${avoidTopics ? `\nTopics already covered — do NOT repeat:\n${avoidTopics}` : ''}
Return ONLY a JSON object:
{ "title": "...", "content": "Full HTML body", "metaDescription": "...", "slug": "..." }`
}

function parseAIResponse(rawText: string) {
  const stripped = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  const match    = stripped.match(/\{[\s\S]*\}/)
  if (!match) return { title: '', content: rawText, metaDescription: '', slug: '' }
  try {
    const p = JSON.parse(match[0])
    return { title: String(p.title || ''), content: String(p.content || rawText), metaDescription: String(p.metaDescription || ''), slug: String(p.slug || '') }
  } catch {
    return { title: '', content: rawText, metaDescription: '', slug: '' }
  }
}

function wordCount(html: string) { return html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length }
function headingCount(html: string) { return (html.match(/<h[23][^>]*>/gi) || []).length }
function internalLinks(html: string) { return (html.match(/<a [^>]+>/gi) || []).filter(l => !l.includes('http')).length }
