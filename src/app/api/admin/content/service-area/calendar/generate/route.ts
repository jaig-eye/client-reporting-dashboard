// POST /api/admin/content/service-area/calendar/generate
// Generates scheduled service area topics across a content calendar window.
// Uses configured service_areas list if available; falls back to AI+GSC discovery
// (same logic as the discover endpoint) when no areas are pre-configured.
//
// Body: { client_id, start_date?, weeks_ahead? }
// Returns: { ok: true, count, slots }

import { NextRequest, NextResponse } from 'next/server'
import { cookies }                   from 'next/headers'
import { createAdminClient }         from '@/lib/supabase/server'
import { isAdminAuthed }             from '@/lib/auth'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as { client_id: string; start_date?: string; weeks_ahead?: number }
  const { client_id, start_date, weeks_ahead: weeksAheadParam } = body
  if (!client_id) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

  const db = createAdminClient()

  // ── Load service area config + agency settings in parallel ─────────────────
  const [saRes, agencyRes, contentRes] = await Promise.all([
    db.from('service_area_settings')
      .select('schedule_frequency, schedule_day_of_week, pages_per_run, service_areas, primary_service, location_notes')
      .eq('client_id', client_id)
      .maybeSingle(),
    db.from('agency_settings').select('ai_provider, ai_model, ai_api_key').single(),
    db.from('content_settings').select('geographic_focus, services, business_background').eq('client_id', client_id).maybeSingle(),
  ])

  const sa = saRes.data
  const frequency      = (sa?.schedule_frequency  as string | null) ?? 'monthly'
  const dayOfWeek      = (sa?.schedule_day_of_week as number | null) ?? 1
  const pagesPerRun    = (sa?.pages_per_run        as number | null) ?? 1
  const weeksAhead     = weeksAheadParam ?? 8
  const anchor         = start_date ? new Date(start_date) : new Date()
  const primaryService = (sa?.primary_service as string | null)
    ?? (contentRes.data?.services as string | null)?.split(',')[0]?.trim()
    ?? 'Service'

  type ServiceArea = { city: string; state: string }
  let serviceAreas = (sa?.service_areas as ServiceArea[] | null) ?? []

  // ── If no service areas configured, use AI+GSC to discover them ────────────
  if (serviceAreas.length === 0) {
    const apiKey = agencyRes.data?.ai_api_key as string | null
    if (!apiKey) {
      return NextResponse.json(
        { error: 'No service areas configured and no AI key set. Add service areas in settings or configure AI in Agency Settings.' },
        { status: 400 }
      )
    }

    // Load GSC top queries + sitemap service pages in parallel
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90)
    const [gscRes, sitemapRes] = await Promise.all([
      db.from('gsc_metrics')
        .select('query, impressions, clicks')
        .eq('client_id', client_id)
        .gte('date', cutoff.toISOString().slice(0, 10))
        .not('query', 'is', null)
        .order('impressions', { ascending: false })
        .limit(200),
      db.from('content_sitemap_pages')
        .select('url')
        .eq('client_id', client_id)
        .limit(100),
    ])

    // Top 30 queries by impressions — sent raw to the AI without regex pre-filtering
    // (previous regex was case-sensitive, missing lowercase GSC queries)
    const topQueries = (gscRes.data ?? [] as { query: string | null; impressions: number }[])
      .slice(0, 30)
      .map((r: { query: string | null; impressions: number }) => `"${r.query}" (${r.impressions} impr)`)
      .join('\n')

    // Service page URLs from sitemap give strong city/region signals
    const sitemapUrls = ((sitemapRes.data ?? []) as { url: string }[])
      .map(p => p.url).join('\n')

    const geoFocus = (contentRes.data?.geographic_focus as string | null) ?? ''
    const bizBg    = (contentRes.data?.business_background as string | null) ?? ''

    // Build a rich prompt — geographic_focus is the primary anchor
    const prompt = `You are a local SEO strategist helping a home service business create service area landing pages.

Primary service: ${primaryService}
Business description: ${bizBg || 'Not provided'}
Primary service area (from brand settings): ${geoFocus || 'Not specified'}

Top Google Search Console queries (last 90 days):
${topQueries || 'No GSC data available'}

Existing sitemap URLs (shows current targeting):
${sitemapUrls || 'None'}

Using the primary service area and surrounding region as the anchor, suggest 12 city/town targets for new service area pages.
Include the primary city plus nearby cities in the same county or metro area.
Focus on real cities the business likely serves based on the service area and GSC signals.

Return ONLY valid JSON, no markdown, no explanation — just the array:
[{"city":"Palm Bay","state":"FL"},{"city":"Melbourne","state":"FL"},...]`

    let aiError = ''
    try {
      const provider = (agencyRes.data?.ai_provider as string | null) || 'anthropic'
      const model    = (agencyRes.data?.ai_model    as string | null) || (provider === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'gpt-4o-mini')
      let rawText = ''

      if (provider === 'anthropic') {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
        })
        if (!res.ok) { const t = await res.text(); throw new Error(`AI API error ${res.status}: ${t}`) }
        const d = await res.json() as { content?: { text: string }[] }
        rawText = d.content?.[0]?.text ?? ''
      } else {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 1024 }),
        })
        if (!res.ok) { const t = await res.text(); throw new Error(`AI API error ${res.status}: ${t}`) }
        const d = await res.json() as { choices?: { message: { content: string } }[] }
        rawText = d.choices?.[0]?.message?.content ?? ''
      }

      const match = rawText.match(/\[[\s\S]*\]/)
      if (match) serviceAreas = JSON.parse(match[0]) as ServiceArea[]
      else aiError = `AI returned unexpected format: ${rawText.slice(0, 200)}`
    } catch (err) {
      aiError = String(err)
      console.error('[SA calendar/generate] AI discovery failed:', aiError)
    }

    if (serviceAreas.length === 0) {
      return NextResponse.json(
        { error: `Could not determine service areas. ${aiError ? `AI error: ${aiError}` : 'Try adding service areas manually in settings.'}` },
        { status: 400 }
      )
    }
  }

  // ── Compute publish slots ───────────────────────────────────────────────────
  const slots = computeSlots({ anchor, weeksAhead, frequency, dayOfWeek })
  if (slots.length === 0) {
    return NextResponse.json({ error: 'No publish slots computed for the given parameters' }, { status: 400 })
  }

  // ── Load existing SA topics (avoid duplicate city/service per slot) ─────────
  const { data: existingTopics } = await db
    .from('content_topics')
    .select('city, state_abbr, service_name, target_publish_date')
    .eq('client_id', client_id)
    .eq('content_type', 'service_area')
    .not('status', 'eq', 'rejected')

  const existingKeys = new Set(
    (existingTopics ?? []).map(t => `${t.city ?? ''}|${t.state_abbr ?? ''}|${t.service_name ?? ''}`)
  )

  // ── Generate topics, cycling through service_areas ──────────────────────────
  const toInsert: {
    client_id: string
    content_type: string
    city: string
    state_abbr: string
    service_name: string
    topic: string
    status: string
    target_publish_date: string
  }[] = []

  let areaIndex = 0
  for (const slot of slots) {
    for (let p = 0; p < pagesPerRun; p++) {
      // Advance to the next area not already queued for ANY date (cycle from the list)
      let attempts = 0
      while (attempts < serviceAreas.length) {
        const area = serviceAreas[areaIndex % serviceAreas.length]
        areaIndex++
        const key = `${area.city}|${area.state}|${primaryService}`
        if (!existingKeys.has(key)) {
          existingKeys.add(key) // prevent duplicating within this generation run
          toInsert.push({
            client_id,
            content_type:        'service_area',
            city:                area.city,
            state_abbr:          area.state,
            service_name:        primaryService,
            topic:               `${primaryService} in ${area.city}, ${area.state}`,
            status:              'pending',
            target_publish_date: slot,
          })
          break
        }
        attempts++
      }
    }
  }

  if (toInsert.length === 0) {
    return NextResponse.json(
      { error: 'All configured service areas are already queued. Add more locations or clear rejected topics.' },
      { status: 400 }
    )
  }

  const { error } = await db.from('content_topics').insert(toInsert)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, count: toInsert.length, slots })
}

// ── Slot computation (mirrors blog calendar/generate) ─────────────────────────

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function computeSlots(params: { anchor: Date; weeksAhead: number; frequency: string; dayOfWeek: number }): string[] {
  const { anchor, weeksAhead, frequency, dayOfWeek } = params
  const end   = new Date(anchor.getTime() + weeksAhead * 7 * 86_400_000)
  const slots: string[] = []

  if (frequency === 'daily') {
    let cur = new Date(anchor)
    while (cur <= end) { slots.push(toIso(cur)); cur = new Date(cur.getTime() + 86_400_000) }
    return slots
  }

  if (frequency === 'weekly' || frequency === 'biweekly') {
    const intervalDays = frequency === 'biweekly' ? 14 : 7
    let cur       = new Date(anchor)
    const daysUntil = (dayOfWeek - cur.getDay() + 7) % 7
    cur = new Date(cur.getTime() + daysUntil * 86_400_000)
    while (cur <= end) { slots.push(toIso(cur)); cur = new Date(cur.getTime() + intervalDays * 86_400_000) }
    return slots
  }

  if (frequency === 'monthly') {
    const targetDay = anchor.getDate()
    let year = anchor.getFullYear(), month = anchor.getMonth()
    while (true) {
      const candidate = new Date(year, month, Math.min(targetDay, daysInMonth(year, month)))
      if (candidate > end) break
      if (candidate >= anchor) slots.push(toIso(candidate))
      month++; if (month > 11) { month = 0; year++ }
    }
    return slots
  }

  // Fallback: biweekly
  let cur = new Date(anchor)
  while (cur <= end) { slots.push(toIso(cur)); cur = new Date(cur.getTime() + 14 * 86_400_000) }
  return slots
}
