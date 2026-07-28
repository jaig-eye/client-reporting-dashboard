// POST /api/admin/content/optimization/build-brief
// Generates and stores a structured optimization brief using AI + competitor analysis.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import { buildOptimizationBrief } from '@/lib/content/siloEngine'

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

  // Sanitize competitor URLs — reject private IPs / non-public hosts
  const competitorUrls = (body.competitor_urls ?? [])
    .filter(u => typeof u === 'string' && isPublicUrl(u))
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
