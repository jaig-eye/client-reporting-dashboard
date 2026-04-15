import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

/**
 * POST /api/admin/content/generate
 *
 * Generates blog post content using the agency-configured AI model.
 * Accepts an optional client_id to inject client background context.
 * Saves the generated post to content_posts and returns the post_id.
 *
 * Body: { prompt, client_id? }
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
    // Extract all <loc> entries (handles both sitemap index and regular sitemaps)
    const matches = Array.from(xml.matchAll(/<loc>\s*(https?:\/\/[^\s<]+)\s*<\/loc>/gi))
    return matches
      .map(m => m[1].trim())
      .filter(url => !url.endsWith('.xml'))   // skip nested sitemap index entries
      .slice(0, 40)
  } catch {
    return []
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = (agency: string, clientContext: string, avoidTopics: string) => `\
You are a professional SEO content writer for ${agency}.
${clientContext ? `\n${clientContext}` : ''}
Your writing demonstrates E-E-A-T (Experience, Expertise, Authority, Trustworthiness):
- Experience: include real-world examples, scenarios, or case studies
- Expertise: demonstrate deep knowledge of the subject
- Authority: use confident, well-supported statements
- Trustworthiness: be accurate, transparent, and avoid clickbait

Topic strategy — write about subjects that genuinely rank well for this type of business:
- Focus on topics that answer real questions the target audience searches for
- Consider commonly searched questions, seasonal relevance, and local industry angles
- Write about subjects that are directly tied to the business's services and value proposition
- Avoid vague or generic titles; be specific and targeted

SEO guidelines:
- Choose a clear focus keyword phrase and use it naturally in the H1, first paragraph, and 2–3 subheadings
- Target ~1% keyword density (roughly once per 100 words)
- Use focus keyword in at least 2 H2/H3/H4 subheadings
- Structure content with H2/H3 subheadings for scannability
- Write introduction paragraphs that hook the reader and include the primary keyword early
- Include a compelling meta description (150–160 characters) that contains the primary keyword
- SEO title should be max 60 characters (can go slightly over), include the focus keyword
- Suggest a clean URL slug: lowercase, hyphens only, no stop words, max 5–6 words
- End with a clear call-to-action relevant to the business
- Include at least 1 outbound link to a credible external resource (industry authority, cited statistic, or reference) when factually relevant
- Add descriptive alt text to any <img> tags — alt text should include the focus keyword

Formatting:
- Return valid HTML for the content body (use <h2>, <h3>, <h4>, <p>, <ul>, <ol>, <strong> tags)
- Do NOT include <html>, <head>, or <body> tags — just the inner content
- Paragraphs should be concise (3–5 sentences max)
- For external links use full URLs with target="_blank" rel="noopener noreferrer" and a dofollow attribute
${avoidTopics ? `\nTopics already covered — do NOT write about these again:\n${avoidTopics}` : ''}
Return ONLY a JSON object with exactly these fields:
{
  "title": "Post H1 title — descriptive, includes focus keyword",
  "seoTitle": "SEO/meta title — max 60 chars, includes focus keyword (may differ slightly from H1)",
  "content": "Full HTML post body (h2, h3, h4, p, ul, strong, a tags as needed)",
  "metaDescription": "SEO meta description, 150–160 characters, includes focus keyword, soft CTA if relevant",
  "slug": "url-friendly-slug-max-5-words",
  "focusKeyword": "primary target keyword phrase this post is optimized for",
  "suggestedTags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}
Do not include markdown fences or any text outside the JSON object.`

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { prompt, client_id } = body as { prompt: string; client_id?: string }

  if (!prompt) {
    return NextResponse.json({ error: 'Missing prompt' }, { status: 400 })
  }

  const db = createAdminClient()

  const [settingsRes, clientSettingsRes, existingPostsRes] = await Promise.all([
    db.from('agency_settings').select('ai_provider, ai_model, ai_api_key, agency_name').single(),
    client_id
      ? db.from('content_settings')
          .select('business_background, services, target_audience, geographic_focus, brand_voice, post_structure, sitemap_url, phone_number')
          .eq('client_id', client_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // Load existing topics to avoid duplicates
    client_id
      ? db.from('content_posts')
          .select('focus_topic, title')
          .eq('client_id', client_id)
          .order('generated_at', { ascending: false })
          .limit(50)
      : Promise.resolve({ data: null }),
  ])

  if (!settingsRes.data?.ai_api_key) {
    return NextResponse.json({ error: 'AI not configured. Add an API key in Agency Settings.' }, { status: 400 })
  }

  const settings       = settingsRes.data
  const clientSettings = clientSettingsRes.data as Record<string, string | null> | null

  // Build client context string to inject into system prompt
  const contextLines: string[] = []
  if (clientSettings) {
    if (clientSettings.business_background) contextLines.push(`Business background: ${clientSettings.business_background}`)
    if (clientSettings.services)            contextLines.push(`Services offered: ${clientSettings.services}`)
    if (clientSettings.target_audience)     contextLines.push(`Target audience: ${clientSettings.target_audience}`)
    if (clientSettings.geographic_focus)    contextLines.push(`Geographic focus: ${clientSettings.geographic_focus}`)
    if (clientSettings.brand_voice)         contextLines.push(`Brand voice: ${clientSettings.brand_voice}`)
    if (clientSettings.phone_number)        contextLines.push(`Business phone: ${clientSettings.phone_number} (when referencing phone in content, format as ${clientSettings.phone_number} linked with tel: href, e.g. <a href="tel:${clientSettings.phone_number.replace(/\D/g, '')}">`)
    if (clientSettings.post_structure)      contextLines.push(`\nPreferred post structure:\n${clientSettings.post_structure}`)
  }

  // Fetch sitemap pages for internal linking context
  if (clientSettings?.sitemap_url) {
    const pages = await fetchSitemapPages(clientSettings.sitemap_url)
    if (pages.length > 0) {
      contextLines.push(`\nAvailable site pages for internal linking (use these URLs as href values for internal links — prefer relative paths if they share the same domain):\n${pages.join('\n')}`)
    }
  }

  const clientContext = contextLines.length > 0 ? `Client context:\n${contextLines.join('\n')}\n` : ''

  // Build "avoid topics" list
  const existingPosts = (existingPostsRes.data ?? []) as { focus_topic?: string; title?: string }[]
  const avoidList = existingPosts
    .map(p => p.focus_topic || p.title)
    .filter(Boolean)
    .slice(0, 30)
    .join('\n')

  const provider = settings.ai_provider || 'anthropic'
  const model    = settings.ai_model || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o')
  const apiKey   = settings.ai_api_key
  const agency   = settings.agency_name || 'the agency'

  const systemPrompt = BASE_SYSTEM_PROMPT(agency, clientContext, avoidList)

  function parseResponse(rawText: string) {
    const stripped = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
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
    const links = (html.match(/<a [^>]+>/gi) || [])
    return links.filter(l => !l.includes('http://') && !l.includes('https://')).length
  }

  try {
    let rawText = ''

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
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`AI API error: ${text}`)
      }
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
            { role: 'user',   content: prompt },
          ],
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`AI API error: ${text}`)
      }
      const data = await res.json()
      rawText = data.choices?.[0]?.message?.content || ''
    }

    const parsed = parseResponse(rawText)

    // Save to content_posts if we have a client_id
    let postId: string | null = null
    if (client_id) {
      const postRow = {
        client_id,
        status:           'pending',
        title:            parsed.title,
        seo_title:        parsed.seoTitle || parsed.title,
        content:          parsed.content,
        meta_description: parsed.metaDescription,
        slug:             parsed.slug,
        target_keyword:   parsed.focusKeyword,
        suggested_tags:   parsed.suggestedTags,
        word_count:       computeWordCount(parsed.content),
        heading_count:    computeHeadingCount(parsed.content),
        internal_links:   computeInternalLinks(parsed.content),
        generated_by:     'manual',
        ai_model:         model,
        prompt_used:      prompt,
      }
      const { data: savedPost } = await db.from('content_posts').insert(postRow).select('id').single()
      postId = savedPost?.id ?? null
    }

    return NextResponse.json({ ...parsed, post_id: postId })

  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
