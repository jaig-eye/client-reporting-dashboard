import { NextRequest, NextResponse } from 'next/server'
import { cookies }           from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed }     from '@/lib/auth'

export const maxDuration = 300

/**
 * POST /api/admin/content/schedule
 *
 * Triggered by Vercel Cron (daily at 6am UTC) or manually by an admin.
 * Loops through all clients with auto_generate = true, checks if they are
 * due for generation today based on their schedule, and generates posts.
 *
 * Auth: admin session cookie OR Vercel cron secret header (CRON_SECRET env var).
 */
export async function POST(request: NextRequest) {
  // Accept either admin session cookie or Vercel cron secret
  const cronSecret  = process.env.CRON_SECRET
  const authHeader  = request.headers.get('authorization')
  const cookieStore = await cookies()
  const session     = cookieStore.get('admin_session')?.value

  const isCronAuth  = cronSecret && authHeader === `Bearer ${cronSecret}`
  const isAdminAuth = isAdminAuthed(session)

  if (!isCronAuth && !isAdminAuth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Optional: target a single client (admin-only manual trigger)
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const targetClientId = isAdminAuth && typeof body.client_id === 'string' ? body.client_id : null

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
    .select('post_structure, schedule_frequency, schedule_day_of_week')
    .is('client_id', null)
    .maybeSingle()

  // Load all clients with auto_generate enabled
  const { data: clientSettingsRows } = await db
    .from('content_settings')
    .select('client_id, business_background, services, target_audience, geographic_focus, brand_voice, post_structure, schedule_frequency, schedule_day_of_week, target_length, connection_id, sitemap_url, phone_number, default_author_id, default_category_ids')
    .eq('auto_generate', true)
    .not('client_id', 'is', null)

  if (!clientSettingsRows?.length) {
    return NextResponse.json({ message: 'No clients with auto_generate enabled', generated: 0 })
  }

  // When targeting a specific client, verify it's in the list
  if (targetClientId && !clientSettingsRows.some(cs => cs.client_id === targetClientId)) {
    return NextResponse.json({ error: 'Client not found or auto_generate not enabled', generated: 0 }, { status: 404 })
  }

  const provider = agencySettings.ai_provider || 'anthropic'
  const model    = agencySettings.ai_model    || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o')
  const apiKey   = agencySettings.ai_api_key
  const agency   = agencySettings.agency_name || 'the agency'
  const gs       = globalSettings as { post_structure?: string; schedule_frequency?: string; schedule_day_of_week?: number } | null
  const globalStructure = gs?.post_structure ?? ''
  const globalFrequency = gs?.schedule_frequency ?? 'weekly'
  const globalDayOfWeek = gs?.schedule_day_of_week ?? 1

  let totalGenerated = 0
  const errors: string[] = []

  for (const cs of clientSettingsRows) {
    if (!cs.client_id) continue
    if (targetClientId && cs.client_id !== targetClientId) continue

    // Determine last generated date for this client
    const { data: lastPost } = await db
      .from('content_posts')
      .select('generated_at')
      .eq('client_id', cs.client_id)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const lastGeneratedAt = (lastPost as { generated_at: string } | null)?.generated_at ?? null

    // Resolve schedule: client override falls back to global default
    const frequency = (cs.schedule_frequency as string  | null) ?? globalFrequency
    const dayOfWeek = (cs.schedule_day_of_week as number | null) ?? globalDayOfWeek

    // Skip if not due today — bypass when admin targets a specific client or when not cron
    if (isCronAuth && !targetClientId && !isDueToday(frequency, dayOfWeek, lastGeneratedAt)) continue

    const postsPerRun  = 1
    const targetLength = (cs.target_length  as number | null) ?? 1500

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
    const phoneNumber = cs.phone_number as string | null
    if (phoneNumber)             contextLines.push(`Business phone: ${phoneNumber} (when referencing phone in content, format as ${phoneNumber} linked with tel: href, e.g. <a href="tel:${phoneNumber.replace(/\D/g, '')}">`)
    const structureNote = (cs.post_structure as string | null) ?? globalStructure
    if (structureNote)           contextLines.push(`\nPreferred post structure:\n${structureNote}`)

    // Fetch sitemap pages for internal linking context
    const sitemapUrl = cs.sitemap_url as string | null
    if (sitemapUrl) {
      const pages = await fetchSitemapPages(sitemapUrl)
      if (pages.length > 0) {
        contextLines.push(`\nAvailable site pages for internal linking:\n${pages.join('\n')}`)
      }
    }

    const clientContext = contextLines.length > 0 ? `Client context:\n${contextLines.join('\n')}\n` : ''
    const systemPrompt  = buildSystemPrompt(agency, clientContext, avoidList)

    for (let i = 0; i < postsPerRun; i++) {
      try {
        const userPrompt = `Write a new SEO-optimized blog post for this business. Research what topics would rank well for this industry — focus on: services they offer, commonly searched questions their customers ask, local/seasonal relevance where applicable, or subjects similar businesses write about. Choose a unique, targeted topic not yet covered. Target approximately ${targetLength} words.`

        let rawText = ''
        if (provider === 'anthropic') {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model, max_tokens: 8192, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
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
          client_id:        cs.client_id,
          connection_id:    cs.connection_id || null,
          status:           'pending',
          title:            parsed.title,
          seo_title:        parsed.seoTitle || parsed.title,
          content:          parsed.content,
          meta_description: parsed.metaDescription,
          slug:             parsed.slug,
          target_keyword:   parsed.focusKeyword,
          suggested_tags:   parsed.suggestedTags,
          word_count:       wordCount(parsed.content),
          heading_count:    headingCount(parsed.content),
          internal_links:   internalLinks(parsed.content),
          generated_by:     'scheduled',
          ai_model:         model,
          prompt_used:      userPrompt,
          wp_author_id:     (cs as Record<string, unknown>).default_author_id    ?? null,
          wp_category_ids:  (cs as Record<string, unknown>).default_category_ids ?? null,
        })

        totalGenerated++
      } catch (err) {
        errors.push(`client ${cs.client_id}: ${String(err)}`)
      }
    }
  }

  return NextResponse.json({ generated: totalGenerated, errors })
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Determines if a client is due for content generation today.
 * daily:         always
 * weekly:        today's weekday matches dayOfWeek
 * biweekly:      today's weekday matches AND last generation was 13+ days ago
 * monthly:       last generation was 28+ days ago (rolling)
 * monthly_first: 1st of the month
 * monthly_mid:   15th of the month
 * monthly_end:   28th of the month
 */
function isDueToday(frequency: string, dayOfWeek: number, lastGeneratedAt: string | null): boolean {
  const now   = new Date()
  const today = now.getDay()    // 0=Sun … 6=Sat
  const dom   = now.getDate()   // 1–31
  const daysSinceLast = lastGeneratedAt
    ? (Date.now() - new Date(lastGeneratedAt).getTime()) / 86_400_000
    : Infinity

  switch (frequency) {
    case 'daily':         return true
    case 'weekly':        return today === dayOfWeek
    case 'biweekly':      return today === dayOfWeek && daysSinceLast >= 13
    case 'monthly':       return daysSinceLast >= 28
    case 'monthly_first': return dom === 1
    case 'monthly_mid':   return dom === 15
    case 'monthly_end':   return dom === 28
    default:              return today === dayOfWeek
  }
}

function buildSystemPrompt(agency: string, clientContext: string, avoidTopics: string): string {
  return `You are a professional SEO content writer for ${agency}.
${clientContext ? `\n${clientContext}` : ''}
Write high-quality blog posts demonstrating E-E-A-T (Experience, Expertise, Authority, Trustworthiness).

Topic strategy — write about subjects that genuinely rank well for this type of business:
- Focus on topics that answer real questions the target audience searches for
- Consider commonly searched questions, seasonal relevance, and local industry angles
- Write about subjects directly tied to the business's services and value proposition
- Avoid vague or generic titles; be specific and targeted

SEO guidelines:
- Choose a clear focus keyword and use it in the H1, first paragraph, and 2–3 subheadings
- Target ~1% keyword density (roughly once per 100 words)
- Include a compelling meta description (150–160 characters) with the focus keyword
- SEO title max 60 chars (can go slightly over), includes focus keyword
- Suggest a clean URL slug: lowercase, hyphens, no stop words, max 5–6 words
- End with a clear call-to-action
- Include at least 1 outbound link to a credible external resource when factually relevant
- Add descriptive alt text to any <img> tags including the focus keyword
- For external links use target="_blank" rel="noopener noreferrer"
${avoidTopics ? `\nTopics already covered — do NOT repeat:\n${avoidTopics}` : ''}
Return ONLY a JSON object with exactly these fields:
{
  "title": "Post H1 title — descriptive, includes focus keyword",
  "seoTitle": "SEO/meta title — max 60 chars, includes focus keyword",
  "content": "Full HTML post body (h2, h3, h4, p, ul, strong, a tags as needed)",
  "metaDescription": "SEO meta description, 150–160 characters, includes focus keyword",
  "slug": "url-friendly-slug-max-5-words",
  "focusKeyword": "primary target keyword phrase",
  "suggestedTags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}
Do not include markdown fences or any text outside the JSON object.`
}

function parseAIResponse(rawText: string) {
  const stripped = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  const match    = stripped.match(/\{[\s\S]*\}/)
  if (!match) return { title: '', seoTitle: '', content: rawText, metaDescription: '', slug: '', focusKeyword: '', suggestedTags: [] as string[] }
  try {
    const p = JSON.parse(match[0])
    return {
      title:           String(p.title           || ''),
      seoTitle:        String(p.seoTitle         || p.title || ''),
      content:         String(p.content          || rawText),
      metaDescription: String(p.metaDescription  || ''),
      slug:            String(p.slug             || ''),
      focusKeyword:    String(p.focusKeyword      || ''),
      suggestedTags:   Array.isArray(p.suggestedTags) ? p.suggestedTags.map(String) : [] as string[],
    }
  } catch {
    return { title: '', seoTitle: '', content: rawText, metaDescription: '', slug: '', focusKeyword: '', suggestedTags: [] as string[] }
  }
}

function wordCount(html: string) { return html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length }
function headingCount(html: string) { return (html.match(/<h[234][^>]*>/gi) || []).length }
function internalLinks(html: string) { return (html.match(/<a [^>]+>/gi) || []).filter(l => !l.includes('http')).length }
