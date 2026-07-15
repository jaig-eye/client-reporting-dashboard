// POST /api/admin/content/service-area/generate
// Generates a service area landing page from an approved SA topic.
// Body: { topic_id: string }

import { NextRequest, NextResponse } from 'next/server'
import { waitUntil }                 from '@vercel/functions'
import { cookies }                   from 'next/headers'
import { createAdminClient }         from '@/lib/supabase/server'
import { isAdminAuthed }             from '@/lib/auth'
import { buildServiceAreaSlug }      from '@/lib/content/buildServiceAreaSlug'
import type { SlugStructure }        from '@/lib/content/buildServiceAreaSlug'

export const maxDuration = 300

// Appended to custom master prompts so Claude always returns structured JSON.
// DEFAULT_SA_PROMPT already ends with an equivalent instruction.
const JSON_OUTPUT_INSTRUCTION = `

Return ONLY valid JSON — no markdown fences, no preamble, no commentary after the closing brace:
{
  "title": "Page H1 / WordPress page title",
  "seoTitle": "SEO title including brand name, primary service, and city",
  "content": "Full HTML body starting with an H2 tag, never H1. Pure HTML only, no markdown.",
  "metaDescription": "150-160 character meta description including city and service",
  "focusKeyword": "primary keyword"
}`

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeEmDashes(html: string): string {
  return html.replace(/(<[^>]*>)|([^<]+)/g, (_, tag, text) => {
    if (tag) return tag
    return text
      .replace(/—/g, ' - ')
      .replace(/–/g, '-')
  })
}

function repairJsonStrings(json: string): string {
  let out = '', inStr = false, esc = false
  for (const ch of json) {
    if (esc)                { out += ch; esc = false; continue }
    if (ch === '\\' && inStr) { out += ch; esc = true; continue }
    if (ch === '"')           { out += ch; inStr = !inStr; continue }
    if (inStr && ch === '\n') { out += '\\n'; continue }
    if (inStr && ch === '\r') { out += '\\r'; continue }
    if (inStr && ch === '\t') { out += '\\t'; continue }
    out += ch
  }
  return out
}

function parseResponse(rawText: string) {
  const stripped   = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  const start      = stripped.indexOf('{')
  const end        = stripped.lastIndexOf('}')
  const jsonMatch  = start !== -1 && end > start ? [stripped.slice(start, end + 1)] : null
  if (jsonMatch) {
    for (const attempt of [jsonMatch[0], repairJsonStrings(jsonMatch[0])]) {
      try {
        const parsed = JSON.parse(attempt)
        return {
          title:           sanitizeEmDashes(String(parsed.title           || '')),
          seoTitle:        sanitizeEmDashes(String(parsed.seoTitle        || parsed.title || '')),
          content:         sanitizeEmDashes(String(parsed.content         || rawText)),
          metaDescription: sanitizeEmDashes(String(parsed.metaDescription || '')),
          focusKeyword:    String(parsed.focusKeyword || ''),
        }
      } catch { /* next attempt */ }
    }
  }
  // Fallback: just return text as content
  return {
    title:           '',
    seoTitle:        '',
    content:         sanitizeEmDashes(rawText),
    metaDescription: '',
    focusKeyword:    '',
  }
}

function formatEeat(eeatRaw: unknown): string {
  if (!eeatRaw) return ''
  const e = typeof eeatRaw === 'string' ? (() => { try { return JSON.parse(eeatRaw) } catch { return null } })() : eeatRaw
  if (!e || typeof e !== 'object') return ''
  const r = e as Record<string, unknown>
  const parts: string[] = []
  if (r.years_in_business)      parts.push(`${r.years_in_business} years in business`)
  if (r.licenses)               parts.push(`licensed: ${r.licenses}`)
  if (r.review_count)           parts.push(`${r.review_count} reviews`)
  if (r.guarantees)             parts.push(`guarantees: ${r.guarantees}`)
  if (r.emergency_availability) parts.push('24/7 emergency service available')
  if (r.insurance)              parts.push(`insured: ${r.insurance}`)
  return parts.join('. ')
}

function stripHallucinatedLinks(html: string, allowedUrls: Set<string>): string {
  if (allowedUrls.size === 0) return html
  const norm = (u: string) => u.replace(/\/+$/, '').toLowerCase()
  const allowed = new Set(Array.from(allowedUrls).map(norm))
  const internalHosts = new Set<string>()
  Array.from(allowed).forEach(u => {
    try { internalHosts.add(new URL(u).hostname.toLowerCase()) } catch { /* relative */ }
  })
  return html.replace(/<a\s([^>]*)>([\s\S]*?)<\/a>/gi, (match, attrs: string, text: string) => {
    const m = attrs.match(/href\s*=\s*["']([^"']*)["']/i)
    if (!m) return match
    const href = m[1].trim()
    if (/^(mailto:|tel:|#)/.test(href)) return match
    if (/^https?:/.test(href)) {
      try {
        const parsed = new URL(href)
        const hostname = parsed.hostname.toLowerCase()
        if (internalHosts.size > 0 && !internalHosts.has(hostname)) return match
        if (allowed.has(norm(href))) return match
        if (allowed.has(norm(parsed.pathname))) return match
        console.warn('[sa-generate] stripped hallucinated internal link:', href)
        return text
      } catch { return match }
    }
    if (allowed.has(norm(href))) return match
    console.warn('[sa-generate] stripped hallucinated internal link:', href)
    return text
  })
}

// ─── Core generation ──────────────────────────────────────────────────────────

async function generatePage(topicId: string) {
  const db = createAdminClient()

  // Fetch topic
  const { data: topic } = await db
    .from('content_topics')
    .select('id, city, state_abbr, service_name, client_id, content_type, status, target_publish_date')
    .eq('id', topicId)
    .maybeSingle()

  if (!topic || topic.content_type !== 'service_area') {
    return { error: 'Topic not found or not a service_area topic' }
  }
  if (topic.status !== 'approved' && topic.status !== 'generating') {
    return { error: 'Topic is not approved' }
  }

  const city         = (topic.city         as string | null) ?? ''
  const stateAbbr    = (topic.state_abbr   as string | null) ?? ''
  const serviceName  = (topic.service_name as string | null) ?? 'Service'
  const clientId     = topic.client_id as string

  // Mark as generating (no-op if route handler already claimed it — idempotent)
  await db.from('content_topics').update({ status: 'generating' }).eq('id', topicId)

  // Post-level dedup: if a non-rejected post already exists for this city+service, link the
  // topic to it and return early without burning an AI call.
  const { data: existingPost } = await db
    .from('content_posts')
    .select('id')
    .eq('client_id', clientId)
    .eq('city', city)
    .eq('service_name', serviceName)
    .not('status', 'eq', 'rejected')
    .maybeSingle()
  if (existingPost) {
    await db.from('content_topics')
      .update({ status: 'generated', post_id: existingPost.id })
      .eq('id', topicId)
    return { ok: true, post_id: existingPost.id, deduped: true }
  }

  // Parallel: SA settings, agency settings, content_settings (for brand context), service page URL
  const [saRes, agencyRes, csRes, servicePageRes] = await Promise.all([
    db.from('service_area_settings').select('*').eq('client_id', clientId).maybeSingle(),
    db.from('agency_settings').select('ai_provider, ai_model, ai_api_key, service_area_master_prompt, agency_name, discord_bot_token, notify_sa_generated').single(),
    db.from('content_settings').select('business_background, services, target_audience, geographic_focus, brand_voice, phone_number, cta_list, eeat_data, manual_link_urls').eq('client_id', clientId).maybeSingle(),
    db.from('content_sitemap_pages').select('url').eq('client_id', clientId).eq('is_service_page', true).ilike('url', `%${serviceName.toLowerCase().replace(/[^a-z0-9]/g, '-')}%`).maybeSingle(),
  ])

  const saSettings     = (saRes.data    ?? {}) as Record<string, unknown>
  const agency         = agencyRes.data
  const cs             = (csRes.data    ?? {}) as Record<string, unknown>
  const servicePageUrl = (servicePageRes.data as { url: string } | null)?.url ?? null

  const provider  = (agency?.ai_provider  as string | null) || 'anthropic'
  const model     = (agency?.ai_model     as string | null) || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o')
  const apiKey    = agency?.ai_api_key    as string | null
  const masterPrompt = agency?.service_area_master_prompt as string | null

  if (!apiKey) {
    await db.from('content_topics').update({ status: 'approved', generation_error: 'AI API key not configured' }).eq('id', topicId)
    return { error: 'AI not configured' }
  }

  // Upsert SA silo + fetch published sibling city pages for silo context
  let sasiloId: string | null = null
  let sasiloSection = ''
  const { data: saSilo } = await db
    .from('content_silos')
    .upsert({
      client_id:      clientId,
      name:           serviceName,
      hub_page_url:   servicePageUrl,
      hub_page_title: `${serviceName} Services`,
      central_entity: serviceName,
      section:        'core',
      status:         'active',
    }, { onConflict: 'client_id,name' })
    .select('id')
    .maybeSingle()

  if (saSilo) {
    sasiloId = saSilo.id as string
    const { data: siblings } = await db
      .from('content_posts')
      .select('city, state_abbr, published_url')
      .eq('silo_id', sasiloId)
      .in('status', ['draft_saved', 'published'])
      .not('published_url', 'is', null)
      .limit(20)

    if (siblings && siblings.length > 0) {
      const siblingLines = (siblings as { city: string | null; state_abbr: string | null; published_url: string }[])
        .map(s => `  - "${s.city ?? ''}, ${s.state_abbr ?? ''}" at ${s.published_url}`)
        .join('\n')
      sasiloSection = `\n\nSILO CONTEXT — SERVICE AREA CLUSTER:\nHub/service page (link to it once): ${servicePageUrl ?? '[service page not yet indexed]'}\nSibling city pages for ${serviceName} already published:\n${siblingLines}\nCross-link to 2–3 geographically nearby or conceptually related ones.\nUse anchor text: "${serviceName} in [City]" — never generic text.`
    } else if (servicePageUrl) {
      sasiloSection = `\n\nSILO CONTEXT — SERVICE AREA CLUSTER:\nHub/service page (link to it once): ${servicePageUrl}\nThis is the first city page for this service — no siblings to cross-link yet.`
    }
  }

  // Build template variable substitutions
  const slugStructure  = (saSettings.slug_structure as SlugStructure | null) ?? 'service_slash_city_state'
  const targetLength   = (saSettings.target_length  as number | null)         ?? 1200
  const locationNotes  = (saSettings.location_notes as string | null)          ?? ''
  const nearbyTemplate = (saSettings.nearby_areas_template as string | null)   ?? ''

  const brandName    = (agency?.agency_name as string | null) || (cs.business_background as string | null)?.slice(0, 40) || 'Our Team'
  const phone        = (cs.phone_number    as string | null) || '(XXX) XXX-XXXX'
  const phoneRaw     = phone.replace(/\D/g, '')
  const eeat         = formatEeat(cs.eeat_data)
  const services     = (cs.services       as string | null) || serviceName
  const bgContext    = [cs.business_background, cs.brand_voice, cs.target_audience]
    .filter(Boolean).join('. ')

  // Fetch internal link data in parallel:
  // - Priority pages from sitemap (conversion/contact pages)
  // - Published/draft sibling SA pages for the same service (for silo linking)
  // - All non-excluded sitemap pages (for link validation)
  const [priorityPagesRes, siblingPostsRes, allSitemapRes] = await Promise.all([
    db.from('content_sitemap_pages')
      .select('url, title')
      .eq('client_id', clientId)
      .eq('is_priority', true)
      .eq('is_excluded', false)
      .limit(5),
    db.from('content_posts')
      .select('city, state_abbr, published_url, slug')
      .eq('client_id', clientId)
      .eq('service_name', serviceName)
      .in('status', ['published', 'draft_saved'])
      .neq('city', city)
      .limit(20),
    db.from('content_sitemap_pages')
      .select('url')
      .eq('client_id', clientId)
      .eq('is_excluded', false)
      .limit(100),
  ])

  // Parse manual_link_urls from content_settings (JSON array of {url, label})
  type ManualLink = { url: string; label: string }
  const rawManualLinks = cs.manual_link_urls
  let manualLinks: ManualLink[] = []
  if (Array.isArray(rawManualLinks)) {
    manualLinks = (rawManualLinks as unknown[]).map((l: unknown) =>
      typeof l === 'string' ? (() => { try { return JSON.parse(l) as ManualLink } catch { return null } })()
        : (l as ManualLink | null)
    ).filter((l): l is ManualLink => !!l?.url)
  } else if (typeof rawManualLinks === 'string') {
    try { manualLinks = JSON.parse(rawManualLinks) as ManualLink[] } catch { /* ignore */ }
  }

  // Build hub link (service index page — first priority page or manual link that matches service name)
  const priorityPages = (priorityPagesRes.data ?? []) as { url: string; title: string | null }[]
  const hubPage = priorityPages.find(p =>
    p.url.toLowerCase().includes(serviceName.toLowerCase().replace(/\s+/g, '-')) ||
    (p.title ?? '').toLowerCase().includes(serviceName.toLowerCase())
  ) ?? priorityPages[0] ?? null

  const hubLink = hubPage
    ? `<a href="${hubPage.url}">${hubPage.title ?? serviceName} Services</a>`
    : ''

  // Build sibling service area links
  type SiblingPost = { city: string | null; state_abbr: string | null; published_url: string | null; slug: string | null }
  const siblingPosts = (siblingPostsRes.data ?? []) as SiblingPost[]

  // Build allowed URL set for hallucination validation
  const allowedInternalUrls = new Set<string>()
  ;(allSitemapRes.data ?? []).forEach((r: { url: string }) => allowedInternalUrls.add(r.url))
  manualLinks.forEach(l => allowedInternalUrls.add(l.url))
  siblingPosts.forEach(p => {
    const url = p.published_url || (p.slug ? `/${p.slug}` : null)
    if (url) allowedInternalUrls.add(url)
  })
  if (servicePageUrl) allowedInternalUrls.add(servicePageUrl)

  const siblingLinkList = siblingPosts
    .map(p => {
      const url = p.published_url || (p.slug ? `/${p.slug}` : null)
      if (!url || !p.city) return null
      return `<li><a href="${url}">${serviceName} in ${p.city}${p.state_abbr ? `, ${p.state_abbr}` : ''}</a></li>`
    })
    .filter(Boolean)
    .join('\n')

  const siblingLinksHtml = siblingLinkList
    ? `<ul>\n${siblingLinkList}\n</ul>`
    : `<!-- No sibling service area pages published yet for ${serviceName} -->`

  // Build conversion/priority page links (manual links take priority, then sitemap priority pages)
  const conversionLinks = [
    ...manualLinks.map(l => `<a href="${l.url}">${l.label}</a>`),
    ...priorityPages
      .filter(p => !manualLinks.some(m => m.url === p.url))
      .map(p => `<a href="${p.url}">${p.title ?? 'Contact Us'}</a>`),
  ].slice(0, 3).join(', ')

  const DEFAULT_SA_PROMPT = `You are an expert local SEO copywriter specializing in service area landing pages for home service businesses.

Write a complete service area page for [BRAND_NAME] offering [PRIMARY_SERVICE] in [CITY], [STATE].

NON-NEGOTIABLE RULES:
- NEVER use em dashes (—) or en dashes (–). Use a comma or period instead.
- Write in second person ("you", "your")
- Include [CITY] naturally in every H2 heading
- Phone [PHONE] must appear exactly twice as: <a href="tel:[PHONE_RAW]">[PHONE]</a>
- Sentences under 25 words. 7th-grade reading level.
- Use only h2, h3, p, ul, li, strong, a HTML tags. No inline styles, no divs.
- Target word count: [WORD_COUNT]
- NEVER add an H1 tag to the content. The WordPress title field automatically renders as H1.
- NEVER link to external websites. Only use internal links to other pages on this website.

Page Structure:
(WordPress title field sets the H1 — start content with an H2)
Opening: vivid local scenario + brand positioning
H2: Services we offer in [CITY]
H2: Signs you need [PRIMARY_SERVICE] in [CITY] (5-7 bullets)
H2: Why [CITY] homeowners trust [BRAND_NAME] (4-5 bullets with E-E-A-T signals)
H2: Serving [CITY] and surrounding areas
H2: Get a free estimate in [CITY]

Brand Context: [CLIENT_CONTEXT]
E-E-A-T Signals: [EEAT]
Nearby areas to mention: [NEARBY_AREAS]
[LOCATION_NOTES]

Return ONLY valid JSON — no markdown fences, no explanation:
{
  "title": "H1 text (used as WordPress page title)",
  "seoTitle": "SEO title including full company name [BRAND_NAME], primary service, and city",
  "content": "Full HTML body — begins with H2, never H1",
  "metaDescription": "150-160 chars, includes city and primary service",
  "focusKeyword": "primary service city state"
}`

  const promptTemplate = masterPrompt
    ? masterPrompt + JSON_OUTPUT_INSTRUCTION
    : DEFAULT_SA_PROMPT

  // Additional values for blog-style master prompts (shared with content_settings fields)
  const primaryKeyword = `${serviceName} in ${city}, ${stateAbbr}`
  const targetAudience = String(cs.target_audience ?? '')
  const brandVoice     = String(cs.brand_voice     ?? '')
  const ctaText        = String(cs.cta_list         ?? 'Contact us for a free estimate')

  const finalPrompt = promptTemplate
    .replace(/\[BRAND_NAME\]/g, brandName)
    .replace(/\[PRIMARY_SERVICE\]/g, serviceName)
    .replace(/\[CITY\]/g, city)
    .replace(/\[STATE\]/g, stateAbbr)
    .replace(/\[SERVICE_LIST\]/g, services)
    .replace(/\[NEARBY_AREAS\]/g, nearbyTemplate || `nearby communities around ${city}`)
    .replace(/\[NEARBY_REGION\]/g, nearbyTemplate || `the ${city} area`)
    .replace(/\[COUNTY_OR_REGION\]/g, `${city}, ${stateAbbr}`)
    .replace(/\[PHONE\]/g, phone)
    .replace(/\[PHONE_RAW\]/g, phoneRaw)
    .replace(/\[RESPONSE_TIME\]/g, '24 hours')
    .replace(/\[CATEGORY_TAGLINE\]/g, `Professional ${serviceName}`)
    .replace(/\[EEAT\]/g, eeat || 'Licensed, insured, and locally trusted')
    .replace(/\[CLIENT_CONTEXT\]/g, bgContext || brandName)
    .replace(/\[LOCATION_NOTES\]/g, locationNotes ? `Additional guidance: ${locationNotes}` : '')
    .replace(/\[WORD_COUNT\]/g, String(targetLength))
    // Blog-style variables — substituted so master prompts shared with blog generation work
    .replace(/\[BRAND_DESCRIPTION\]/g,               bgContext || brandName)
    .replace(/\[TARGET_AUDIENCE\]/g,                 targetAudience)
    .replace(/\[AUDIENCE_DETAIL\]/g,                 targetAudience)
    .replace(/\[PRIMARY_KEYWORD\]/g,                 primaryKeyword)
    .replace(/\[SECONDARY_KEYWORDS\]/g,              services)
    .replace(/\[SEARCH_INTENT\]/g,                   'transactional')
    .replace(/\[WORKING_TITLE\]/g,                   `${serviceName} in ${city}, ${stateAbbr}`)
    .replace(/\[TARGET_WORD_COUNT\]/g,               String(targetLength))
    .replace(/\[THIS_LOCATION\]/g,                   `${city}, ${stateAbbr}`)
    .replace(/\[VOICE_NOTES\]/g,                     brandVoice)
    .replace(/\[CTA\]/g,                             ctaText)
    .replace(/\[HUB_PAGE_URL_AND_ANCHOR\]/g,             hubLink)
    .replace(/\[LIST_OF_SIBLING_URLS_AND_ANCHORS\]/g,   siblingLinksHtml)
    .replace(/\[LIST_OF_SIBLING_URLS_AND_LOCATIONS\]/g, siblingLinksHtml)
    .replace(/\[URLS_AND_ANCHORS\]/g,                   conversionLinks)
    .replace(/\[[A-Z_]+\]/g,                            '')   // strip any remaining unhandled [VARIABLE] patterns

  const promptWithSilo = finalPrompt + sasiloSection

  // Call AI — check res.ok so API errors surface the real message, not just "Empty AI response"
  let rawText = ''
  try {
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: 'user', content: promptWithSilo }] }),
      })
      if (!res.ok) {
        const errBody = await res.text()
        throw new Error(`Anthropic API ${res.status}: ${errBody.slice(0, 300)}`)
      }
      const d = await res.json() as { content?: { type: string; text: string }[] }
      rawText = d.content?.find(b => b.type === 'text')?.text ?? ''
    } else {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: promptWithSilo }], max_tokens: 4096 }),
      })
      if (!res.ok) {
        const errBody = await res.text()
        throw new Error(`OpenAI API ${res.status}: ${errBody.slice(0, 300)}`)
      }
      const d = await res.json() as { choices?: { message: { content: string } }[] }
      rawText = d.choices?.[0]?.message?.content ?? ''
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AI call failed'
    console.error(`[SA generate] topic ${topicId} AI error:`, msg)
    await db.from('content_topics').update({ status: 'approved', generation_error: msg }).eq('id', topicId)
    return { error: msg }
  }

  if (!rawText.trim()) {
    const msg = 'AI returned empty response — model may be overloaded, try again'
    await db.from('content_topics').update({ status: 'approved', generation_error: msg }).eq('id', topicId)
    return { error: msg }
  }

  const parsed = parseResponse(rawText)
  parsed.content = stripHallucinatedLinks(parsed.content, allowedInternalUrls)
  const slug   = buildServiceAreaSlug(slugStructure, serviceName, city, stateAbbr)

  // Find connection_id from SA settings
  const connectionId = (saSettings.connection_id as string | null) ?? null

  // Save post
  const wordCount    = parsed.content.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
  const headingCount = (parsed.content.match(/<h[234][^>]*>/gi) ?? []).length

  const { data: post, error: postErr } = await db
    .from('content_posts')
    .insert({
      client_id:         clientId,
      connection_id:     connectionId,
      content_type:      'service_area',
      city,
      state_abbr:        stateAbbr,
      service_name:      serviceName,
      service_page_url:  servicePageUrl,
      title:             parsed.title   || `${serviceName} in ${city}, ${stateAbbr}`,
      seo_title:         parsed.seoTitle,
      content:           parsed.content,
      meta_description:  parsed.metaDescription,
      focus_keyword:     parsed.focusKeyword || `${serviceName.toLowerCase()} ${city.toLowerCase()} ${stateAbbr.toLowerCase()}`,
      slug,
      status:            'for_review',
      word_count:        wordCount,
      heading_count:     headingCount,
      target_publish_date: (topic.target_publish_date as string | null) ?? null,
      generated_at:      new Date().toISOString(),
      // Only include silo_id when non-null — column requires migration 149 (content_silos)
      ...(sasiloId ? { silo_id: sasiloId } : {}),
    })
    .select('id')
    .maybeSingle()

  if (postErr || !post) {
    await db.from('content_topics').update({ status: 'approved', generation_error: postErr?.message ?? 'Failed to save post' }).eq('id', topicId)
    return { error: postErr?.message ?? 'Failed to save post' }
  }

  // Mark topic as generated, link post
  await db.from('content_topics')
    .update({ status: 'generated', post_id: post.id })
    .eq('id', topicId)

  // Write admin_alert
  await db.from('admin_alerts').insert({
    type:     'content',
    severity: 'info',
    title:    `Service area page generated`,
    message:  `"${parsed.title || `${serviceName} in ${city}, ${stateAbbr}`}" is ready for review`,
    client_id: clientId,
    meta:     { post_id: post.id, city, state_abbr: stateAbbr, service_name: serviceName },
  }).then(null, () => {})

  // Discord notification
  const discordToken = agency?.discord_bot_token as string | null
  const notifySa = (agency as Record<string, unknown> | null)?.notify_sa_generated !== false
  if (discordToken && notifySa) {
    // Fire-and-forget
    ;(async () => {
      try {
        const { data: client } = await db.from('clients').select('discord_channel_id').eq('id', clientId).single()
        const channelId = (client as Record<string, unknown> | null)?.discord_channel_id as string | null
        if (channelId) {
          await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: 'POST',
            headers: { 'Authorization': `Bot ${discordToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: `📍 **Service area page ready:** "${parsed.title || `${serviceName} in ${city}`}" — ready for review` }),
          })
        }
      } catch { /* ignore */ }
    })()
  }

  return { ok: true, post_id: post.id }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as { topic_id: string }
  const { topic_id } = body
  if (!topic_id) return NextResponse.json({ error: 'topic_id required' }, { status: 400 })

  const db = createAdminClient()
  // Claim the topic atomically before scheduling background work — closes the race window
  // where cron re-fetches 'approved' topics between this response returning and generatePage
  // setting the status to 'generating' via waitUntil.
  const { data: claimed } = await db
    .from('content_topics')
    .update({ status: 'generating' })
    .eq('id', topic_id)
    .eq('status', 'approved')
    .select('id')
    .maybeSingle()
  if (!claimed) {
    return NextResponse.json({ error: 'Topic not available for generation' }, { status: 409 })
  }
  waitUntil(generatePage(topic_id))
  return NextResponse.json({ ok: true, queued: true })
}
