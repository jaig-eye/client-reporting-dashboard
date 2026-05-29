// POST /api/admin/content/service-area/discover
// Analyzes 90 days of GSC data + existing service areas to suggest new city/service combinations.
// Body: { client_id: string }

import { NextRequest, NextResponse } from 'next/server'
import { cookies }                   from 'next/headers'
import { createAdminClient }         from '@/lib/supabase/server'
import { isAdminAuthed }             from '@/lib/auth'
import { buildServiceAreaSlug }      from '@/lib/content/buildServiceAreaSlug'
import type { SlugStructure }        from '@/lib/content/buildServiceAreaSlug'

export const maxDuration = 60

interface DiscoverySuggestion {
  city:                  string
  state:                 string
  service_name:          string
  rationale:             string
  estimated_opportunity: 'high' | 'medium' | 'low'
}

// Normalize a city name to a consistent slug key
function cityKey(city: string, state: string): string {
  return `${city.toLowerCase().replace(/[^a-z0-9]/g, '')}_${state.toLowerCase().replace(/[^a-z]/g, '')}`
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as { client_id: string }
  const { client_id } = body
  if (!client_id) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

  const db = createAdminClient()

  // Fetch SA settings, agency AI config, and GSC connection in parallel
  const [saSettingsRes, agencyRes, gscConnRes] = await Promise.all([
    db.from('service_area_settings').select('*').eq('client_id', client_id).maybeSingle(),
    db.from('agency_settings').select('ai_provider, ai_model, ai_api_key').single(),
    db.from('client_connections')
      .select('id')
      .eq('client_id', client_id)
      .eq('status', 'active')
      .eq('connectors.type', 'google_search_console')
      .maybeSingle(),
  ])

  const saSettings = saSettingsRes.data as Record<string, unknown> | null
  const agencySettings = agencyRes.data
  const gscConnectionId = (gscConnRes.data as { id: string } | null)?.id

  if (!agencySettings?.ai_api_key) {
    return NextResponse.json({ error: 'AI not configured — add an API key in Agency Settings' }, { status: 400 })
  }

  // Fetch GSC data from last 90 days grouped by query + page
  let gscRows: { query: string | null; page: string | null; clicks: number; impressions: number }[] = []
  if (gscConnectionId) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 90)
    const { data } = await db
      .from('gsc_metrics')
      .select('query, page, clicks, impressions')
      .eq('client_id', client_id)
      .gte('date', cutoff.toISOString().slice(0, 10))
      .not('query', 'is', null)
      .order('impressions', { ascending: false })
      .limit(500)
    gscRows = (data ?? []) as typeof gscRows
  }

  // Aggregate GSC data by query
  const queryMap = new Map<string, { clicks: number; impressions: number; pages: Set<string> }>()
  for (const row of gscRows) {
    if (!row.query) continue
    const key = row.query.toLowerCase()
    const existing = queryMap.get(key) ?? { clicks: 0, impressions: 0, pages: new Set() }
    existing.clicks += row.clicks ?? 0
    existing.impressions += row.impressions ?? 0
    if (row.page) existing.pages.add(row.page)
    queryMap.set(key, existing)
  }

  // Extract geographic signals from queries
  const geoSignals: { term: string; clicks: number; impressions: number }[] = []
  const geoPatterns = [
    /\bin\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),?\s*([A-Z]{2})\b/,  // "in Palm Bay FL" or "in Palm Bay, FL"
    /\bnear\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i,              // "near Palm Bay"
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:fl|tx|ca|ny|ga|nc|va|oh|pa|az|co|wa|or|mn|wi|mo|tn|sc|al|la|ky|ok|ar|ms|ia|ks|ut|nv|nm|ne|id|nh|me|ri|ct|de|vt|mt|wy|sd|nd|ak|hi|wv|in|mi|il|md|nj|ma)\b/i,
  ]

  for (const [query, stats] of queryMap) {
    for (const pattern of geoPatterns) {
      const m = query.match(pattern)
      if (m) {
        geoSignals.push({ term: query, clicks: stats.clicks, impressions: stats.impressions })
        break
      }
    }
  }

  // Build existing city set from service_area_settings.service_areas
  const existingAreas = (saSettings?.service_areas as { city: string; state: string }[] | null) ?? []
  const existingKeys = new Set(existingAreas.map(a => cityKey(a.city, a.state)))

  // Fetch already queued/generated SA topics and sitemap pages
  const [topicsRes, sitemapRes] = await Promise.all([
    db.from('content_topics')
      .select('city, state_abbr, service_name')
      .eq('client_id', client_id)
      .eq('content_type', 'service_area')
      .not('status', 'eq', 'rejected'),
    db.from('content_sitemap_pages')
      .select('url')
      .eq('client_id', client_id),
  ])

  const queuedKeys = new Set(
    ((topicsRes.data ?? []) as { city: string | null; state_abbr: string | null; service_name: string | null }[])
      .filter(t => t.city && t.state_abbr)
      .map(t => cityKey(t.city!, t.state_abbr!))
  )

  const sitemapUrls = new Set(((sitemapRes.data ?? []) as { url: string }[]).map(p => p.url.toLowerCase()))

  const slugStructure = (saSettings?.slug_structure as SlugStructure | null) ?? 'service_slash_city_state'
  const servicePages = (saSettings?.service_pages as { name: string }[] | null) ?? []
  const primaryService = (saSettings?.primary_service as string | null) ?? servicePages[0]?.name ?? 'Service'

  // Prepare context for AI
  const topGeoSignals = geoSignals
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 30)
    .map(s => `"${s.term}" — ${s.impressions} impressions, ${s.clicks} clicks`)
    .join('\n')

  const existingList = existingAreas.slice(0, 20).map(a => `${a.city}, ${a.state}`).join('; ') || 'None yet'

  const aiPrompt = `You are a local SEO strategist. A home service business needs service area page suggestions.

Business service: ${primaryService}
Existing service areas (already have pages or are queued): ${existingList}

Top geographic search signals from Google Search Console (last 90 days):
${topGeoSignals || 'No GSC data available — suggest based on typical home service expansion patterns'}

Based on these signals, suggest 10–15 new city/service combinations worth creating service area pages for.
Prioritize cities with high impression/click signals. Avoid duplicating the existing areas listed.

Return ONLY valid JSON array — no markdown, no explanation:
[
  {
    "city": "City Name",
    "state": "FL",
    "service_name": "${primaryService}",
    "rationale": "brief reason (e.g. '450 impressions for tree service palm bay fl')",
    "estimated_opportunity": "high" | "medium" | "low"
  }
]`

  const provider = (agencySettings.ai_provider as string | null) || 'anthropic'
  const model    = (agencySettings.ai_model    as string | null) || (provider === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'gpt-4o-mini')
  const apiKey   = agencySettings.ai_api_key as string

  let suggestions: DiscoverySuggestion[] = []
  try {
    let rawText = ''
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 2048, messages: [{ role: 'user', content: aiPrompt }] }),
      })
      const d = await res.json() as { content?: { text: string }[] }
      rawText = d.content?.[0]?.text ?? ''
    } else {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: aiPrompt }], max_tokens: 2048 }),
      })
      const d = await res.json() as { choices?: { message: { content: string } }[] }
      rawText = d.choices?.[0]?.message?.content ?? ''
    }

    const jsonMatch = rawText.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as DiscoverySuggestion[]
      // Deduplicate against existing queue and sitemap
      suggestions = parsed.filter(s => {
        const key = cityKey(s.city, s.state)
        if (existingKeys.has(key) || queuedKeys.has(key)) return false
        // Loose sitemap check
        const slug = buildServiceAreaSlug(slugStructure, s.service_name, s.city, s.state)
        const slugCity = s.city.toLowerCase().replace(/[^a-z]/g, '')
        return !Array.from(sitemapUrls).some(u => u.includes(slugCity))
      })
    }
  } catch {
    // AI failed — return empty suggestions without breaking
  }

  return NextResponse.json({ suggestions })
}
