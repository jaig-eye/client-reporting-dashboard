import { NextRequest, NextResponse } from 'next/server'
import { PLATFORM_BOT_UA } from '@/lib/platformBot'
import { cookies }           from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession, verifyCronAuth } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { recheckPostQuality } from '@/lib/content/recheckQuality'

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
  // Accept either admin session cookie or Vercel cron secret.
  //
  // verifyCronAuth, not a bare ===. This is a registered Vercel cron entry point
  // and was the last one still comparing the header with `===`, which
  // short-circuits on the first differing byte and so leaks CRON_SECRET to a
  // timing probe from an unauthenticated caller. It also skips the loud
  // "CRON_SECRET is not set" log every sibling route now emits.
  const cookieStore = await cookies()
  const session     = cookieStore.get('admin_session')?.value

  const isCronAuth  = verifyCronAuth(request.headers.get('authorization'))
  const isAdminAuth = isAdminAuthed(session)

  if (!isCronAuth && !isAdminAuth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminSession = isAdminAuth ? await getAdminSession() : null
  const ip = isAdminAuth ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() : undefined

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
    .select('client_id, business_background, services, target_audience, geographic_focus, brand_voice, post_structure, schedule_frequency, schedule_day_of_week, target_length, connection_id, sitemap_url, manual_link_urls, phone_number, default_author_id, default_category_ids, blog_url_prefix')
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

    // Idempotency guard: cron should never generate twice in the same UTC day.
    // Prevents duplicate posts when a cron run and a manual admin run overlap.
    if (isCronAuth) {
      const todayUTC = new Date().toISOString().slice(0, 10)
      if (lastGeneratedAt && lastGeneratedAt.slice(0, 10) === todayUTC) continue
    }

    const postsPerRun  = 1
    const targetLength = (cs.target_length  as number | null) ?? 1500

    // Load existing posts and queued topics together to prevent cannibalization
    // Rejected content STAYS in the avoid-list. Both queries used to exclude it, which had
    // the rule backwards: rejection is the editorial signal that a human saw this exact angle
    // and turned it down, so excluding it left the subject free to be commissioned again under
    // a new title on every subsequent run. lib/content/generateTopics.ts makes the same point
    // at its own avoid-list query -- deletion, not rejection, is what makes a subject eligible.
    const [{ data: existingPosts }, { data: queuedTopics }] = await Promise.all([
      db.from('content_posts')
        .select('focus_topic, title, target_keyword')
        .eq('client_id', cs.client_id)
        .order('generated_at', { ascending: false })
        .limit(100),
      db.from('content_topics')
        .select('topic, target_keyword')
        .eq('client_id', cs.client_id)
        .not('status', 'eq', 'generating'),
    ])

    const avoidList = [
      ...((existingPosts ?? []) as { focus_topic?: string; title?: string; target_keyword?: string | null }[])
        .map(p => {
          const label = p.focus_topic || p.title || ''
          if (!label) return null
          return p.target_keyword ? `"${label}" (keyword: ${p.target_keyword})` : `"${label}"`
        }),
      ...((queuedTopics ?? []) as { topic?: string; target_keyword?: string | null }[])
        .map(t => {
          const label = t.topic || ''
          if (!label) return null
          return t.target_keyword ? `"${label}" (keyword: ${t.target_keyword}) [queued]` : `"${label}" [queued]`
        }),
    ].filter(Boolean).join('\n')

    // Build client context
    const contextLines: string[] = []
    if (cs.business_background) contextLines.push(`Business background: ${cs.business_background}`)
    if (cs.services)             contextLines.push(`Services: ${cs.services}`)
    if (cs.target_audience)      contextLines.push(`Target audience: ${cs.target_audience}`)
    if (cs.geographic_focus)     contextLines.push(`Geographic focus: ${cs.geographic_focus}`)
    if (cs.brand_voice)          contextLines.push(`Brand voice: ${cs.brand_voice}`)
    const phoneNumber = cs.phone_number as string | null
    if (phoneNumber) {
      const safePhone = phoneNumber.replace(/[\r\n]/g, ' ')
      contextLines.push(`Business phone: ${safePhone} (when referencing phone in content, format as ${safePhone} linked with tel: href, e.g. <a href="tel:${safePhone.replace(/\D/g, '')}">`)
    }
    const structureNote = (cs.post_structure as string | null) ?? globalStructure
    if (structureNote)           contextLines.push(`\nPreferred post structure:\n${structureNote}`)
    const blogUrlPrefix = cs.blog_url_prefix as string | null
    if (blogUrlPrefix) {
      // Sanitize blog_url_prefix to path-safe characters only
      const safeBlogPrefix = (blogUrlPrefix ?? '').replace(/[^A-Za-z0-9/_-]/g, '').replace(/\/+$/, '')
      contextLines.push(`Blog URL structure: Blog posts on this site use the path prefix "${safeBlogPrefix}/". All valid blog post URLs are already listed in the "Available site pages" list above — use ONLY those exact URLs. Do NOT construct or infer any blog post URL by combining this prefix with a slug.`)
    }

    // Fetch sitemap pages for internal linking context
    const sitemapUrl = cs.sitemap_url as string | null
    const allowedInternalUrls = new Set<string>()
    if (sitemapUrl) {
      const pages = await fetchSitemapPages(sitemapUrl)
      if (pages.length > 0) {
        contextLines.push(`\nAvailable site pages for internal linking:\n${pages.join('\n')}`)
        pages.forEach(u => allowedInternalUrls.add(u))
      }
    }
    // Seed manually configured link URLs so they aren't stripped as hallucinations
    parseManualLinks((cs.manual_link_urls as string[] | null) ?? [])
      .forEach(l => allowedInternalUrls.add(l.url))
    // Pull cached sitemap pages from DB as fallback for clients with no live sitemap_url
    const { data: cachedPages } = await db
      .from('content_sitemap_pages')
      .select('url')
      .eq('client_id', cs.client_id)
      .eq('is_excluded', false)
      .limit(100)
    ;(cachedPages ?? []).forEach((r: { url: string }) => allowedInternalUrls.add(r.url))

    const clientContext = contextLines.length > 0 ? `Client context:\n${contextLines.join('\n')}\n` : ''
    const systemPrompt  = buildSystemPrompt(agency, clientContext, avoidList)

    for (let i = 0; i < postsPerRun; i++) {
      try {
        const userPrompt = `Write a new SEO-optimized blog post for this business. Research what topics would rank well for this industry — focus on: services they offer, commonly searched questions their customers ask, local/seasonal relevance where applicable, or subjects similar businesses write about. Choose a unique, targeted topic not yet covered. Target approximately ${targetLength} words.`

        let rawText = ''
        const aiSignal = AbortSignal.timeout(85_000)
        if (provider === 'anthropic') {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            signal: aiSignal,
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model, max_tokens: 8192, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
          })
          if (!res.ok) {
            const errBody = await res.text()
            throw new Error(`AI error ${res.status}: ${errBody.slice(0, 200)}`)
          }
          const data = await res.json()
          const tb = data.content?.find((b: Record<string, unknown>) => b.type === 'text')
          rawText = tb?.text || ''
        } else {
          const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            signal: aiSignal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }),
          })
          if (!res.ok) {
            const errBody = await res.text()
            throw new Error(`AI error ${res.status}: ${errBody.slice(0, 200)}`)
          }
          const data = await res.json()
          rawText = data.choices?.[0]?.message?.content || ''
        }

        const parsed = parseAIResponse(rawText)
        if (!parsed.title && !parsed.content) continue
        parsed.content = stripHallucinatedLinks(parsed.content, allowedInternalUrls)
        parsed.content = stripDangerousHtml(parsed.content)

        const nowIso  = new Date().toISOString()
        const todayStr = nowIso.slice(0, 10)

        // Guard: ensure no other active content already has this target_publish_date for this client
        const { data: dateConflict } = await db
          .from('content_posts')
          .select('id, title')
          .eq('client_id', cs.client_id)
          .eq('target_publish_date', todayStr)
          .maybeSingle()

        if (dateConflict) {
          errors.push(`client ${cs.client_id}: a post is already scheduled for ${todayStr} — skipped`)
          continue
        }

        const { data: inserted, error: insertErr } = await db.from('content_posts').insert({
          client_id:           cs.client_id,
          connection_id:       cs.connection_id || null,
          status:              'pending',
          title:               parsed.title,
          seo_title:           parsed.seoTitle || parsed.title,
          content:             parsed.content,
          meta_description:    parsed.metaDescription,
          slug:                parsed.slug,
          target_keyword:      parsed.focusKeyword,
          suggested_tags:      parsed.suggestedTags,
          word_count:          wordCount(parsed.content),
          heading_count:       headingCount(parsed.content),
          internal_links:      internalLinks(parsed.content),
          generated_by:        'scheduled',
          ai_model:            model,
          prompt_used:         userPrompt,
          generated_at:        nowIso,
          target_publish_date: todayStr,
          wp_author_id:        (cs as Record<string, unknown>).default_author_id    ?? null,
          wp_category_ids:     (cs as Record<string, unknown>).default_category_ids ?? null,
        })
          .select('id')
          .maybeSingle()
        if (insertErr) {
          errors.push(`client ${cs.client_id}: DB insert failed — ${insertErr.message}`)
          continue
        }
        // Scheduled posts went in with no quality report, and the cron auto-push
        // gate fails closed on a missing one — so they were all held with no way
        // to clear it. Score them on the same terms as every other path.
        if (inserted?.id) await recheckPostQuality(db, inserted.id as string)
        totalGenerated++
      } catch (err) {
        errors.push(`client ${cs.client_id}: ${String(err)}`)
      }
    }
  }

  if (isAdminAuth) {
    logActivity(adminSession, 'generated', 'post', {
      clientId: targetClientId ?? undefined,
      ip,
      meta: { trigger: 'manual_schedule', generated: totalGenerated, errors: errors.length },
    })
  }

  return NextResponse.json({ generated: totalGenerated, errors })
}

// ─── Sitemap fetching ─────────────────────────────────────────────────────────

function isPublicUrl(rawUrl: string): boolean {
  let u: URL
  try { u = new URL(rawUrl) } catch { return false }
  if (!['http:', 'https:'].includes(u.protocol)) return false
  const host = u.hostname.toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false
  if (host === 'metadata.google.internal' || host === 'metadata.goog') return false
  const oct = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (oct) {
    const [a, b] = [Number(oct[1]), Number(oct[2])]
    if (a === 10 || a === 127 || a === 0) return false
    if (a === 172 && b >= 16 && b <= 31)  return false
    if (a === 192 && b === 168)            return false
    if (a === 169 && b === 254)            return false
    if (a === 100 && b >= 64 && b <= 127) return false
  }
  if (host === '::1' || host === '[::1]' || host.startsWith('fe80')) return false
  return true
}

async function fetchSitemapPages(sitemapUrl: string): Promise<string[]> {
  if (!isPublicUrl(sitemapUrl)) return []
  try {
    const res = await fetch(sitemapUrl, {
      signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': PLATFORM_BOT_UA },
    })
    if (!res.ok) return []
    const xml = await res.text()
    const matches = Array.from(xml.matchAll(/<loc>\s*(https?:\/\/[^\s<]+)\s*<\/loc>/gi))
    return matches
      .map(m => m[1].trim())
      .filter(url => !url.endsWith('.xml'))
      .slice(0, 100)
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
  const today = now.getUTCDay()    // 0=Sun … 6=Sat (UTC-consistent — server TZ may not be local)
  const dom   = now.getUTCDate()   // 1–31 (UTC-consistent)
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

function stripDangerousHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^>]*\/?>/gi, '')
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, '')
    .replace(/ on\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/ on\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\bhref\s*=\s*["']\s*javascript:/gi, 'href="javascript_removed:')
    .replace(/\bsrc\s*=\s*["']\s*javascript:/gi, 'src="javascript_removed:')
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

function stripHallucinatedLinks(html: string, allowedUrls: Set<string>): string {
  if (allowedUrls.size === 0) return html
  const norm = (u: string) => u.replace(/\/+$/, '').toLowerCase()
  const allowed = new Set(Array.from(allowedUrls).map(norm))
  const internalHosts = new Set<string>()
  Array.from(allowed).forEach(u => {
    try { internalHosts.add(new URL(u).hostname.toLowerCase()) } catch { /* relative — skip */ }
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
        // When no internal hosts are known we can't tell internal from external — leave all absolute URLs alone
        if (internalHosts.size === 0) return match
        // Known external hostname — leave untouched
        if (!internalHosts.has(hostname)) return match
        // Check full absolute URL first, then path-only (handles relative-URL allowed sets)
        if (allowed.has(norm(href))) return match
        if (allowed.has(norm(parsed.pathname))) return match
        console.warn('[schedule] stripped hallucinated internal link:', href)
        return text
      } catch { return match }
    }
    if (allowed.has(norm(href))) return match
    console.warn('[schedule] stripped hallucinated internal link:', href)
    return text
  })
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
- INTERNAL LINKS — CRITICAL: ONLY use URLs that appear verbatim in the "Available site pages for internal linking" list. Do NOT invent, guess, or construct any internal URL. Any internal link to a URL not explicitly in that list is a critical error.
${avoidTopics ? `\nCANNIBALIZATION PREVENTION — CRITICAL: the following titles and target keywords are already published or in progress. You MUST NOT target the same keyword, answer the same core question, or produce content that would compete for the same search ranking as any post listed below. Choose a topic with a clearly different target keyword and distinct search intent:\n${avoidTopics}` : ''}
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
