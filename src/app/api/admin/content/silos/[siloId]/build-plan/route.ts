// POST /api/admin/content/silos/[siloId]/build-plan
// Uses AI to generate a complete silo keyword map and content plan.
// Saves keywords, pages, and link recommendations to the database.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import { buildSiloPlan } from '@/lib/content/siloEngine'

export const maxDuration = 120

export async function POST(
  request: NextRequest,
  { params }: { params: { siloId: string } }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { siloId } = params

  const db = createAdminClient()

  // Load silo + agency AI settings in parallel
  const [siloRes, agencyRes] = await Promise.all([
    db.from('content_silos')
      .select('id, client_id, name, hub_page_url, hub_page_title, central_entity')
      .eq('id', siloId)
      .maybeSingle(),
    db.from('agency_settings')
      .select('ai_provider, ai_model, ai_api_key')
      .single(),
  ])

  const silo   = siloRes.data
  const agency = agencyRes.data as { ai_provider: string | null; ai_model: string | null; ai_api_key: string } | null

  if (!silo)   return NextResponse.json({ error: 'Silo not found' }, { status: 404 })
  if (!agency?.ai_api_key) return NextResponse.json({ error: 'AI not configured' }, { status: 400 })

  // Optional: client business context
  const { data: settings } = await db
    .from('content_settings')
    .select('business_background, services, geographic_focus, target_audience')
    .eq('client_id', silo.client_id)
    .maybeSingle()

  const contextParts: string[] = []
  if (settings?.business_background) contextParts.push(`Business: ${settings.business_background}`)
  if (settings?.services)            contextParts.push(`Services: ${settings.services}`)
  if (settings?.geographic_focus)    contextParts.push(`Location: ${settings.geographic_focus}`)
  if (settings?.target_audience)     contextParts.push(`Audience: ${settings.target_audience}`)

  const provider = agency.ai_provider || 'anthropic'
  const model    = agency.ai_model    || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o')

  const body = await request.json().catch(() => ({})) as { target_location?: string }

  try {
    const result = await buildSiloPlan({
      siloId,
      clientId:      silo.client_id,
      hubKeyword:    silo.name,
      hubPageUrl:    silo.hub_page_url,
      hubPageTitle:  silo.hub_page_title,
      centralEntity: silo.central_entity,
      targetLocation: body.target_location ?? null,
      clientContext: contextParts.join('\n') || undefined,
      provider,
      model,
      apiKey: agency.ai_api_key,
    })

    return NextResponse.json({
      ok: true,
      keywordsCreated: result.keywordIds.length,
      pagesCreated:    result.pageIds.length,
      linksCreated:    result.linkIds.length,
    })
  } catch (err) {
    console.error('[build-plan] Failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
