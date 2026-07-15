import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { logActivity } from '@/lib/activity'

/**
 * POST /api/admin/content/regenerate
 *
 * Re-runs AI generation for an existing content_post with optional edit instructions.
 * Updates the post in-place and returns the new content.
 *
 * Body: { post_id, edit_notes }
 * Returns: { title, content, metaDescription, slug }
 */
export async function POST(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const adminSession = await getAdminSession()
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()

  const body = await request.json()
  const { post_id, edit_notes } = body as { post_id: string; edit_notes?: string }

  if (!post_id) return NextResponse.json({ error: 'Missing post_id' }, { status: 400 })

  const db = createAdminClient()

  const [postRes, settingsRes] = await Promise.all([
    db.from('content_posts').select('*').eq('id', post_id).single(),
    db.from('agency_settings').select('ai_provider, ai_model, ai_api_key, agency_name').single(),
  ])

  const post = postRes.data as Record<string, string | null> | null
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  if (!settingsRes.data?.ai_api_key) return NextResponse.json({ error: 'AI not configured' }, { status: 400 })

  const settings = settingsRes.data
  const provider = settings.ai_provider || 'anthropic'
  const model    = settings.ai_model    || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o')
  const apiKey   = settings.ai_api_key
  const agency   = settings.agency_name || 'the agency'

  // Build the revised prompt
  const originalPrompt = post.prompt_used || `Write a blog post titled: ${post.title}`
  const editInstruction = edit_notes
    ? `\n\nRevision instructions from the editor:\n${edit_notes}`
    : ''
  const finalPrompt = `${originalPrompt}${editInstruction}`

  const systemPrompt = `You are a professional SEO content writer for ${agency}. Revise or rewrite the blog post as instructed. Return ONLY a JSON object with these fields: { "title": "...", "content": "Full HTML body", "metaDescription": "SEO meta 150-160 chars", "slug": "url-slug" }. Do not include markdown fences.`

  function parseResponse(rawText: string) {
    const stripped = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const match = stripped.match(/\{[\s\S]*\}/)
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

  function parseManualLinks(manualLinkUrls: string[]): { url: string }[] {
    return (manualLinkUrls ?? []).flatMap(s => {
      try {
        const p = JSON.parse(s)
        if (p && typeof p === 'object' && p.url) return [{ url: String(p.url) }]
      } catch { /* ignore */ }
      if (typeof s === 'string' && s.startsWith('http')) return [{ url: s }]
      return []
    })
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
          console.warn('[regenerate] stripped hallucinated internal link:', href)
          return text
        } catch { return match }
      }
      if (allowed.has(norm(href))) return match
      console.warn('[regenerate] stripped hallucinated internal link:', href)
      return text
    })
  }

  try {
    let rawText = ''
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 4096, system: systemPrompt, messages: [{ role: 'user', content: finalPrompt }] }),
      })
      if (!res.ok) { const t = await res.text(); throw new Error(`AI error: ${t}`) }
      const data = await res.json()
      const tb = data.content?.find((b: Record<string, unknown>) => b.type === 'text')
      rawText = tb?.text || ''
    } else {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: finalPrompt }] }),
      })
      if (!res.ok) { const t = await res.text(); throw new Error(`AI error: ${t}`) }
      const data = await res.json()
      rawText = data.choices?.[0]?.message?.content || ''
    }

    const parsed = parseResponse(rawText)

    // Build allowed URL set and strip any hallucinated internal links the AI invented
    const allowedUrls = new Set<string>()
    if (post.client_id) {
      const [{ data: contentSettingsData }, { data: sitemapData }] = await Promise.all([
        db.from('content_settings').select('manual_link_urls').eq('client_id', post.client_id).maybeSingle(),
        db.from('content_sitemap_pages').select('url').eq('client_id', post.client_id).eq('is_excluded', false).limit(100),
      ])
      ;(sitemapData ?? []).forEach((r: { url: string }) => allowedUrls.add(r.url))
      parseManualLinks((contentSettingsData?.manual_link_urls as string[] | null) ?? [])
        .forEach(l => allowedUrls.add(l.url))
    }
    parsed.content = stripHallucinatedLinks(parsed.content, allowedUrls)

    // Update the post in the database
    await db.from('content_posts').update({
      title:           parsed.title,
      content:         parsed.content,
      meta_description: parsed.metaDescription,
      slug:            parsed.slug,
      word_count:      wordCount(parsed.content),
      heading_count:   headingCount(parsed.content),
      internal_links:  internalLinks(parsed.content),
      edit_notes:      edit_notes || null,
      ai_model:        model,
      prompt_used:     finalPrompt,
      status:          'pending',
    }).eq('id', post_id)

    logActivity(adminSession, 'regenerated', 'post', {
      resourceId: post_id,
      ip,
      meta: { title: parsed.title, model, has_edit_notes: !!edit_notes },
    })

    return NextResponse.json(parsed)

  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
