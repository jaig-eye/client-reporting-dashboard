// POST /api/admin/content/optimization/audit
// Scores content against a stored brief and saves an audit snapshot.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import { auditContent, fetchPageText } from '@/lib/content/siloEngine'
import type { OptimizationBrief } from '@/lib/types'

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

  if (!pageText && body.target_url) {
    pageText = await fetchPageText(body.target_url)
  }

  if (!pageText && body.content_post_id) {
    const { data: post } = await db
      .from('content_posts')
      .select('content')
      .eq('id', body.content_post_id)
      .maybeSingle()
    pageText = (post?.content as string | null) ?? null
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
      targetUrl:     body.target_url ?? null,
    })
    return NextResponse.json({ ok: true, audit_id: auditId })
  } catch (err) {
    console.error('[audit] Failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
