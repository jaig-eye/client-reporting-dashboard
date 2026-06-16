// POST /api/admin/content/optimization/build-brief
// Generates and stores a structured optimization brief using AI + competitor analysis.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import { buildOptimizationBrief } from '@/lib/content/siloEngine'

export const maxDuration = 120

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    client_id:        string
    primary_keyword:  string
    silo_id?:         string | null
    silo_page_id?:    string | null
    content_topic_id?: string | null
    content_post_id?:  string | null
    target_url?:       string | null
    target_location?:  string | null
    competitor_urls?:  string[]
  }

  if (!body.client_id || !body.primary_keyword?.trim())
    return NextResponse.json({ error: 'Missing client_id or primary_keyword' }, { status: 400 })

  const db = createAdminClient()
  const { data: agency } = await db
    .from('agency_settings')
    .select('ai_provider, ai_model, ai_api_key')
    .single()

  const ag = agency as { ai_provider: string | null; ai_model: string | null; ai_api_key: string } | null
  if (!ag?.ai_api_key) return NextResponse.json({ error: 'AI not configured' }, { status: 400 })

  const provider = ag.ai_provider || 'anthropic'
  const model    = ag.ai_model    || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o')

  // Sanitize competitor URLs
  const competitorUrls = (body.competitor_urls ?? [])
    .filter(u => typeof u === 'string' && u.startsWith('http'))
    .slice(0, 5)

  try {
    const briefId = await buildOptimizationBrief({
      clientId:       body.client_id,
      siloId:         body.silo_id         ?? null,
      siloPageId:     body.silo_page_id    ?? null,
      contentTopicId: body.content_topic_id ?? null,
      contentPostId:  body.content_post_id  ?? null,
      primaryKeyword: body.primary_keyword.trim(),
      targetUrl:      body.target_url      ?? null,
      targetLocation: body.target_location ?? null,
      competitorUrls,
      provider, model, apiKey: ag.ai_api_key,
    })
    return NextResponse.json({ ok: true, brief_id: briefId })
  } catch (err) {
    console.error('[build-brief] Failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
