// POST /api/admin/content/posts/[id]/full-regenerate
//
// Generates a completely fresh topic + content for this post's date slot.
// Unlike /regenerate (which rewrites existing content), this picks a brand-new
// topic/keyword, generates new content, and replaces everything in place.
//
// Body:  { edit_notes?: string }   — optional direction for the new content
// Returns: { ok: true, queued: true }
//
// The post status is set to 'generating' synchronously before returning.
// A waitUntil background job handles topic generation + AI + DB update,
// then flips status back to 'for_review' when done.

import { releaseKeywordForTopic } from '@/lib/content/siloQueue'
import { NextRequest, NextResponse }      from 'next/server'
import { waitUntil }                      from '@vercel/functions'
import { cookies }                        from 'next/headers'
import { createAdminClient }              from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { logActivity }                    from '@/lib/activity'
import { generateTopicsForClient }        from '@/lib/content/generateTopics'
import { buildRewriteSystemPrompt }       from '@/lib/content/rewritePrompt'
import { styleTables }                    from '@/lib/content/contentHtml'

export const maxDuration = 300

// ── Helpers (shared with /regenerate) ────────────────────────────────────────

function sanitizeEmDashes(html: string): string {
  return html.replace(/(<[^>]*>)|([^<]+)/g, (_, tag, text) => {
    if (tag) return tag
    return text.replace(/—/g, ' - ').replace(/–/g, '-')
  })
}

function repairJsonStrings(json: string): string {
  let out = '', inStr = false, esc = false
  for (const ch of json) {
    if (esc)                  { out += ch; esc = false; continue }
    if (ch === '\\' && inStr) { out += ch; esc = true;  continue }
    if (ch === '"')           { out += ch; inStr = !inStr; continue }
    if (inStr && ch === '\n') { out += '\\n'; continue }
    if (inStr && ch === '\r') { out += '\\r'; continue }
    if (inStr && ch === '\t') { out += '\\t'; continue }
    out += ch
  }
  return out
}

function parseResponse(rawText: string) {
  const stripped = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  const match = stripped.match(/\{[\s\S]*\}/)
  if (!match) return { title: '', content: sanitizeEmDashes(rawText), metaDescription: '', slug: '' }
  for (const attempt of [match[0], repairJsonStrings(match[0])]) {
    try {
      const p = JSON.parse(attempt)
      return {
        title:           sanitizeEmDashes(String(p.title           || '')),
        content:         sanitizeEmDashes(String(p.content         || rawText)),
        metaDescription: sanitizeEmDashes(String(p.metaDescription || '')),
        slug:            String(p.slug || ''),
      }
    } catch { /* try next */ }
  }
  return { title: '', content: sanitizeEmDashes(rawText), metaDescription: '', slug: '' }
}

function wordCount(html: string)    { return html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length }
function headingCount(html: string) { return (html.match(/<h[23][^>]*>/gi) || []).length }
function internalLinks(html: string){ return (html.match(/<a [^>]+>/gi) || []).filter(l => !l.includes('http')).length }

function stripDangerousHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^>]*\/?>/gi, '')
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, '')
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
    .replace(/\bhref(\s*=\s*)(["'])\s*javascript:/gi, 'href$1$2javascript_removed:')
    .replace(/\bsrc(\s*=\s*)(["'])\s*javascript:/gi,  'src$1$2javascript_removed:')
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
        if (internalHosts.size === 0) return match
        if (!internalHosts.has(hostname)) return match
        if (allowed.has(norm(href))) return match
        if (allowed.has(norm(parsed.pathname))) return match
        return text
      } catch { return match }
    }
    if (allowed.has(norm(href))) return match
    return text
  })
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: postId } = await params
  const body = await request.json().catch(() => ({})) as { edit_notes?: string }
  const { edit_notes } = body

  const db = createAdminClient()

  const { data: post } = await db
    .from('content_posts')
    .select('id, client_id, topic_id, target_publish_date, status, content_type, wp_post_id, bc_post_id, admin_approved_at')
    .eq('id', postId)
    .maybeSingle()

  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  // Regenerating a post that is already on the client's site is allowed, but the
  // caller needs to know the live copy will go stale until it is re-pushed. The
  // platform ids and admin_approved_at are deliberately PRESERVED: they record
  // that a CMS copy exists and that a human approved it, both still true. The
  // "live copy is out of date" state is then derived from updated_at >
  // last_pushed_at rather than being smuggled into `status`. See migration 200.
  const pr        = post as Record<string, unknown>
  const isLive    = Boolean(pr.wp_post_id || pr.bc_post_id)

  // Mark as generating atomically — the neq guard acts as the idempotency check so two
  // concurrent requests can't both claim the slot (no TOCTOU window)
  const { data: claimed, error: genErr } = await db
    .from('content_posts')
    .update({ status: 'generating' })
    .eq('id', postId)
    .neq('status', 'generating')
    .select('id')
  if (genErr) return NextResponse.json({ error: `Failed to mark post as generating: ${genErr.message}` }, { status: 500 })
  if (!claimed?.length) return NextResponse.json({ ok: true, queued: false, reason: 'Already regenerating' })

  // Capture admin session before returning — cookies are request-scoped
  const adminSession = await getAdminSession()

  // Hoisted so the catch block can reverse topic state changes made in step 2
  let newTopicId: string | undefined

  waitUntil((async () => {
    try {
      // 1. Generate a fresh topic — generateTopicsForClient builds its own avoid list
      //    from existing topics, so it naturally avoids the current topic.
      const topicResult = await generateTopicsForClient(
        db,
        post.client_id as string,
        1,
        (post.target_publish_date as string | null) ?? undefined,
        {
          suppressEmail: true,
          contentType:   (post.content_type as string | undefined) ?? undefined,
        }
      )

      if (topicResult.error || !topicResult.topics.length) {
        throw new Error(topicResult.error ?? 'No topics generated')
      }

      newTopicId = topicResult.topics[0].id

      // 2. Immediately claim the new topic and retire the old one — do this BEFORE the AI call
      //    so that no cron run can pick up either topic during the (potentially long) generation window.
      await db.from('content_topics')
        .update({ post_id: postId, status: 'approved' })
        .eq('id', newTopicId)

      if (post.topic_id) {
        await db.from('content_topics')
          .update({ post_id: null, status: 'rejected' })
          .eq('id', post.topic_id as string)
        // The superseded topic hands its silo keyword back to the queue; the new
        // topic claims its own. Skipping this strands the term as used forever.
        await releaseKeywordForTopic(db, post.topic_id as string).catch(() => {})
      }

      // 3. Fetch full topic data (TopicSummary only has a few fields)
      const { data: newTopic } = await db
        .from('content_topics')
        .select('id, topic, target_keyword, rationale, keyword_opportunity, ranking_strategy, audience_intent, why_now, competition_level')
        .eq('id', newTopicId)
        .maybeSingle()

      if (!newTopic) throw new Error('New topic row not found')

      // 3. Fetch AI config + client guidelines
      const [agencyRes, settingsRes] = await Promise.all([
        db.from('agency_settings')
          .select('ai_provider, ai_model, ai_api_key, agency_name')
          .maybeSingle(),
        db.from('content_settings')
          .select('topic_guidelines, target_length')
          .eq('client_id', post.client_id)
          .maybeSingle(),
      ])

      if (!agencyRes.data?.ai_api_key) throw new Error('AI not configured')

      const provider     = (agencyRes.data.ai_provider as string | null) || 'anthropic'
      const model        = (agencyRes.data.ai_model    as string | null) || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o')
      const apiKey       = agencyRes.data.ai_api_key as string
      const agency       = (agencyRes.data.agency_name as string | null) || 'the agency'
      const guidelines   = (settingsRes.data?.topic_guidelines as string | null) ?? ''
      const targetLength = (settingsRes.data?.target_length as number | null) ?? 1500

      // 4. Allowed URLs for hallucination stripping
      const { data: sitemapData } = await db
        .from('content_sitemap_pages')
        .select('url')
        .eq('client_id', post.client_id)
        .eq('is_excluded', false)
        .limit(200)
      const allowedUrls = new Set<string>((sitemapData ?? []).map((r: { url: string }) => r.url))

      // 5. Build generation prompt from new topic data
      const breakdown = [
        (newTopic.keyword_opportunity as string | null) && `Keyword opportunity: ${newTopic.keyword_opportunity}`,
        (newTopic.ranking_strategy    as string | null) && `Ranking strategy: ${newTopic.ranking_strategy}`,
        (newTopic.audience_intent     as string | null) && `Audience intent: ${newTopic.audience_intent}`,
        (newTopic.why_now             as string | null) && `Why now: ${newTopic.why_now}`,
        (newTopic.competition_level   as string | null) && `Competition: ${newTopic.competition_level}`,
      ].filter(Boolean).join('\n')

      const editDirection = edit_notes?.trim()
        ? `\n\nEditor direction:\n${edit_notes.slice(0, 2000)}`
        : ''

      const userPrompt = `Write a comprehensive ${targetLength}-word blog post for ${agency}.

Topic: ${newTopic.topic}
Target keyword: ${(newTopic.target_keyword as string | null) ?? 'not specified'}

Topic analysis:
${breakdown || (newTopic.rationale as string | null) || ''}${guidelines ? `\n\nContent guidelines:\n${guidelines}` : ''}${editDirection}

Requirements:
- Full HTML body (h2, h3, p, ul, strong — no h1)
- Naturally weave in the target keyword across headings and body
- Specific, practical information a local reader would act on
- Professional but conversational tone`

      // Rich system prompt (internal-link allow-list + external-source rule + E-E-A-T +
      // writer-quality bar + FAQ/Key-Takeaways structure) — parity with fresh generation.
      const systemPrompt = buildRewriteSystemPrompt({
        agency,
        allowedUrls: Array.from(allowedUrls),
        isBlog: ((post.content_type as string | null) ?? 'blog') === 'blog',
      })

      // 6. Call AI
      let rawText = ''
      if (provider === 'anthropic') {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body:    JSON.stringify({ model, max_tokens: 8192, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
        })
        if (!res.ok) throw new Error(`AI error: ${await res.text()}`)
        const data = await res.json()
        rawText = (data.content?.find((b: Record<string, unknown>) => b.type === 'text') as { text: string } | undefined)?.text ?? ''
      } else {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body:    JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }),
        })
        if (!res.ok) throw new Error(`AI error: ${await res.text()}`)
        const data = await res.json()
        rawText = (data.choices?.[0]?.message?.content as string | undefined) ?? ''
      }

      // 7. Parse + sanitize
      const parsed = parseResponse(rawText)
      if (!parsed.title || !parsed.slug) throw new Error('AI returned invalid content: missing title or slug')
      parsed.content = stripHallucinatedLinks(parsed.content, allowedUrls)
      parsed.content = stripDangerousHtml(parsed.content)
      parsed.content = styleTables(parsed.content)

      // 8. Update post in-place with new content + mark new topic as fully generated
      const { error: saveErr } = await db.from('content_posts').update({
        title:            parsed.title,
        content:          parsed.content,
        meta_description: parsed.metaDescription,
        slug:             parsed.slug,
        target_keyword:   newTopic.target_keyword,
        focus_topic:      newTopic.topic,
        topic_rationale:  newTopic.rationale,
        topic_id:         newTopic.id,
        word_count:       wordCount(parsed.content),
        heading_count:    headingCount(parsed.content),
        internal_links:   internalLinks(parsed.content),
        edit_notes:       edit_notes || null,
        ai_model:         model,
        prompt_used:      userPrompt,
        status:           'for_review',
      }).eq('id', postId)
      if (saveErr) throw new Error(`Failed to save generated content: ${saveErr.message}`)

      // Topic was already claimed (step 2); mark it generated now that content is saved.
      await db.from('content_topics')
        .update({ status: 'generated' })
        .eq('id', newTopic.id as string)

      // 9. Admin alert — visible in the admin alert badge
      await db.from('admin_alerts').insert({
        type:      'content',
        severity:  'info',
        client_id: post.client_id,
        title:     `Post regenerated: ${parsed.title}`,
        body:      `Slot: ${(post.target_publish_date as string | null) ?? 'no date'} → ${newTopic.topic as string}`,
        link_url:  '/admin/content',
      })

      await logActivity(adminSession, 'regenerated', 'post', {
        resourceId: postId,
        meta: { topic: newTopic.topic, keyword: newTopic.target_keyword },
      })

    } catch (err) {
      console.error('[full-regenerate] error:', err)
      // Only roll back if the post is still 'generating' — don't clobber a successful step 8
      const { data: currentPost } = await db
        .from('content_posts')
        .select('status')
        .eq('id', postId)
        .maybeSingle()
      if (currentPost?.status === 'generating') {
        await db.from('content_posts').update({ status: 'for_review' }).eq('id', postId)
        // Reverse topic state changes made in step 2
        if (newTopicId) {
          await db.from('content_topics').update({ post_id: null, status: 'rejected' }).eq('id', newTopicId)
        }
        if (post.topic_id) {
          await db.from('content_topics')
            .update({ post_id: postId, status: 'approved' })
            .eq('id', post.topic_id as string)
        }
      }
    }
  })())

  // wasLive tells the UI to warn that the client's site still shows the old copy
  // until the regenerated post is pushed again.
  return NextResponse.json({ ok: true, queued: true, wasLive: isLive })
}
