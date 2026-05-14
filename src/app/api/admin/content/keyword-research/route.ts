// GET /api/admin/content/keyword-research?client_id=X
// Returns seed keyword candidates derived from the client's services field.
// Uses SerpAPI (from agency_settings) if configured; returns empty list if not.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { isAdminAuthed } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'

type SerpResult = {
  organic_results?: Array<{
    title?: string
    snippet?: string
    link?: string
  }>
  related_searches?: Array<{ query?: string }>
  knowledge_graph?: { title?: string; description?: string }
}

function extractSeedKeywords(services: string | null): string[] {
  if (!services) return []
  return services
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 3)
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId = request.nextUrl.searchParams.get('client_id')
  if (!clientId) return NextResponse.json({ error: 'Missing client_id' }, { status: 400 })

  const db = createAdminClient()

  const [settingsRes, agencyRes, clientRes] = await Promise.all([
    db.from('content_settings')
      .select('services, geographic_focus')
      .eq('client_id', clientId)
      .maybeSingle(),
    db.from('agency_settings')
      .select('serpapi_key')
      .single(),
    db.from('clients')
      .select('name')
      .eq('id', clientId)
      .single(),
  ])

  const services = settingsRes.data?.services ?? null
  const geo      = settingsRes.data?.geographic_focus ?? ''
  const serpKey  = agencyRes.data?.serpapi_key ?? process.env.SERPAPI_KEY ?? null

  const seeds = extractSeedKeywords(services)

  if (!serpKey || seeds.length === 0) {
    return NextResponse.json({
      keywords: [],
      competitors: [],
      hasSerpApi: !!serpKey,
      seeds,
    })
  }

  // Query SerpAPI for each seed keyword
  const keywordResults: Array<{ keyword: string; relatedSearches: string[] }> = []
  const competitorUrls = new Set<string>()

  for (const seed of seeds) {
    const query = geo ? `${seed} ${geo}` : seed
    try {
      const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(serpKey)}&num=5&engine=google`
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) continue
      const data = await res.json() as SerpResult

      const related = (data.related_searches ?? [])
        .map(r => r.query)
        .filter((q): q is string => Boolean(q))
        .slice(0, 5)

      keywordResults.push({ keyword: query, relatedSearches: related })

      // Collect competitor URLs from organic results
      for (const r of (data.organic_results ?? []).slice(0, 3)) {
        if (r.link) {
          try {
            const domain = new URL(r.link).hostname.replace('www.', '')
            if (!domain.includes('google') && !domain.includes('yelp') && !domain.includes('facebook'))
              competitorUrls.add(domain)
          } catch { /* skip malformed URLs */ }
        }
      }
    } catch { /* skip failed queries */ }
  }

  return NextResponse.json({
    keywords: keywordResults,
    competitors: Array.from(competitorUrls).slice(0, 5),
    hasSerpApi: true,
    seeds,
    client: clientRes.data?.name ?? '',
  })
}
