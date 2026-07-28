// POST /api/admin/content/optimization/audit
// Scores content against a stored brief and saves an audit snapshot.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import { auditContent, fetchPageText } from '@/lib/content/siloEngine'
import type { OptimizationBrief } from '@/lib/types'

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

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    brief_id:         string
    client_id:        string
    silo_id?:         string | null
    silo_page_id?:    string | null
    content_post_id?: string | null
    target_url?:      string | null
    page_text?:       string | null  // supply directly, or we fetch target_url
  }

  if (!body.brief_id || !body.client_id)
    return NextResponse.json({ error: 'Missing brief_id or client_id' }, { status: 400 })

  const db = createAdminClient()
  const { data: brief, error: briefError } = await db
    .from('content_optimization_briefs')
    .select('*')
    .eq('id', body.brief_id)
    .maybeSingle()

  if (briefError) return NextResponse.json({ error: briefError.message }, { status: 500 })
  if (!brief)     return NextResponse.json({ error: 'Brief not found' }, { status: 404 })

  // Get page text: use supplied text, or fetch from URL, or get from stored post content
  let pageText = body.page_text ?? null
  let rawHtml: string | null = null

  if (!pageText && body.target_url) {
    if (!isPublicUrl(body.target_url))
      return NextResponse.json({ error: 'Invalid or non-public target_url' }, { status: 422 })
    pageText = await fetchPageText(body.target_url)
  }

  if (!pageText && body.content_post_id) {
    const { data: post } = await db
      .from('content_posts')
      .select('content')
      .eq('id', body.content_post_id)
      .maybeSingle()
    rawHtml = (post?.content as string | null) ?? null
    pageText = rawHtml
  }

  if (!pageText)
    return NextResponse.json({ error: 'No page text available for audit. Provide page_text, target_url, or content_post_id.' }, { status: 400 })

  try {
    const auditId = await auditContent({
      clientId:      body.client_id,
      siloId:        body.silo_id        ?? null,
      siloPageId:    body.silo_page_id   ?? null,
      contentPostId: body.content_post_id ?? null,
      brief:         brief as OptimizationBrief,
      pageText,
      rawHtml,
      targetUrl:     body.target_url ?? null,
    })
    return NextResponse.json({ ok: true, audit_id: auditId })
  } catch (err) {
    console.error('[audit] Failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
