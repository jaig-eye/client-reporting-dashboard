// POST /api/admin/content/service-area/calendar/generate
// Generates scheduled service area topics for upcoming publish slots.
//
// Service detection (in priority order):
//   1. primary_service from service_area_settings
//   2. Most common service slug parsed from sitemap service pages
//   3. First service from brand DNA
//
// Location discovery (in priority order):
//   1. service_areas list from service_area_settings (if configured)
//   2. AI using: geographic_focus + GSC top queries + sitemap URLs
//
// Duplicate prevention:
//   - Parses existing sitemap service pages against the configured slug_structure
//   - Skips any city+service combo that already has a live page in the sitemap
//   - Also skips combos already queued in content_topics
//
// Each created topic includes a rationale field.
//
// Body: { client_id, start_date?, weeks_ahead? }
// Returns: { ok: true, count, slots, skipped }

import { NextRequest, NextResponse } from 'next/server'
import { cookies }                   from 'next/headers'
import { createAdminClient }         from '@/lib/supabase/server'
import { isAdminAuthed }             from '@/lib/auth'

export const maxDuration = 60

// ── URL parsing helpers ────────────────────────────────────────────────────────

function slugToTitle(slug: string): string {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/** Parse a city_state slug like "palm-bay-fl" → { city: "Palm bay", state: "FL" } */
function parseCityState(cityStateSlug: string): { city: string; state: string } | null {
  // Last segment after the final hyphen is the state abbreviation
  const lastHyphen = cityStateSlug.lastIndexOf('-')
  if (lastHyphen === -1) return null
  const statePart = cityStateSlug.slice(lastHyphen + 1)
  const cityPart  = cityStateSlug.slice(0, lastHyphen)
  if (statePart.length !== 2 || !cityPart) return null
  return { city: slugToTitle(cityPart), state: statePart.toUpperCase() }
}

interface ParsedPage { service: string; city: string; state: string }

/**
 * Parse a sitemap URL into service + city + state using the configured slug structure.
 * Returns null if the URL doesn't match the expected pattern.
 */
function parseSitemapUrl(rawUrl: string, slugStructure: string): ParsedPage | null {
  let pathname: string
  try {
    pathname = new URL(rawUrl).pathname.replace(/\/$/, '')
  } catch {
    return null
  }

  if (slugStructure === 'service_slash_city_state' || slugStructure === 'service_slash_city') {
    // Pattern: /service-slug/city-state/ or /service-slug/city/
    const parts = pathname.split('/').filter(Boolean)
    if (parts.length !== 2) return null
    const [serviceSlug, citySlug] = parts

    if (slugStructure === 'service_slash_city_state') {
      const parsed = parseCityState(citySlug)
      if (!parsed) return null
      return { service: slugToTitle(serviceSlug), city: parsed.city, state: parsed.state }
    } else {
      return { service: slugToTitle(serviceSlug), city: slugToTitle(citySlug), state: '' }
    }
  }

  if (slugStructure === 'service_dash_city_state') {
    // Pattern: /service-city-state/ — split on known 2-letter state suffix
    const seg = pathname.split('/').filter(Boolean)
    if (seg.length !== 1) return null
    const full = seg[0]
    // State is always the last 2 chars before end; city ends just before state hyphen
    const m = full.match(/^(.+)-([a-z]{2})$/)
    if (!m) return null
    const withoutState = m[1]
    const state = m[2].toUpperCase()
    // Can't cleanly separate service from city without knowing service name length
    // Best-effort: use the first word as service, rest as city
    const dashParts = withoutState.split('-')
    if (dashParts.length < 2) return null
    const service = slugToTitle(dashParts[0])
    const city    = slugToTitle(dashParts.slice(1).join('-'))
    return { service, city, state }
  }

  return null
}

/** Normalise a city+service pair to a dedup key */
function comboKey(city: string, state: string, service: string): string {
  return `${city.toLowerCase().replace(/[^a-z0-9]/g, '')}|${state.toLowerCase()}|${service.toLowerCase().replace(/[^a-z0-9]/g, '')}`
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as { client_id: string; start_date?: string; weeks_ahead?: number }
  const { client_id, start_date, weeks_ahead: weeksAheadParam } = body
  if (!client_id) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

  const db = createAdminClient()

  // ── Load everything in one round-trip ──────────────────────────────────────
  const [saRes, agencyRes, contentRes, sitemapRes, existingTopicsRes, gscRes] = await Promise.all([
    db.from('service_area_settings')
      .select('schedule_frequency, schedule_day_of_week, pages_per_run, service_areas, primary_service, slug_structure, location_notes')
      .eq('client_id', client_id)
      .maybeSingle(),
    db.from('agency_settings').select('ai_provider, ai_model, ai_api_key').single(),
    db.from('content_settings').select('geographic_focus, services, business_background').eq('client_id', client_id).maybeSingle(),
    db.from('content_sitemap_pages').select('url, is_service_page').eq('client_id', client_id),
    db.from('content_topics')
      .select('city, state_abbr, service_name')
      .eq('client_id', client_id)
      .eq('content_type', 'service_area')
      .not('status', 'eq', 'rejected'),
    db.from('gsc_metrics')
      .select('query, impressions')
      .eq('client_id', client_id)
      .gte('date', (() => { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().slice(0, 10) })())
      .not('query', 'is', null)
      .order('impressions', { ascending: false })
      .limit(200),
  ])

  const sa           = saRes.data
  const slugStructure = (sa?.slug_structure as string | null) ?? 'service_slash_city_state'
  const frequency    = (sa?.schedule_frequency  as string | null) ?? 'monthly'
  const dayOfWeek    = (sa?.schedule_day_of_week as number | null) ?? 1
  const pagesPerRun  = (sa?.pages_per_run        as number | null) ?? 1
  const weeksAhead   = weeksAheadParam ?? 8
  const anchor       = start_date ? new Date(start_date) : new Date()

  // ── Parse sitemap to extract existing service area pages ───────────────────
  // These are pages that already exist live — we must not duplicate them.
  const allSitemapPages = (sitemapRes.data ?? []) as { url: string; is_service_page: boolean }[]

  // Parse every sitemap page against the slug structure
  const sitemapParsed: ParsedPage[] = allSitemapPages
    .map(p => parseSitemapUrl(p.url, slugStructure))
    .filter((p): p is ParsedPage => p !== null)

  // Detect primary service from sitemap if not configured
  // (most common service slug across all parsed service pages)
  const sitemapServices = sitemapParsed.map(p => p.service)
  const serviceFreq     = new Map<string, number>()
  for (const s of sitemapServices) serviceFreq.set(s, (serviceFreq.get(s) ?? 0) + 1)
  const topSitemapService = Array.from(serviceFreq.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  const primaryService =
    (sa?.primary_service as string | null)?.trim() ||
    topSitemapService ||
    (contentRes.data?.services as string | null)?.split(',')[0]?.trim() ||
    'Service'

  // Build dedup set: sitemap live pages + queued DB topics
  const existingCombos = new Set<string>()
  for (const p of sitemapParsed) {
    existingCombos.add(comboKey(p.city, p.state, p.service))
  }
  for (const t of (existingTopicsRes.data ?? []) as { city: string | null; state_abbr: string | null; service_name: string | null }[]) {
    if (t.city && t.state_abbr && t.service_name) {
      existingCombos.add(comboKey(t.city, t.state_abbr, t.service_name))
    }
  }

  // Already-served cities (for AI context)
  const servedCities = Array.from(new Set(sitemapParsed.map(p => `${p.city}, ${p.state}`)))

  // ── Resolve service areas list ─────────────────────────────────────────────
  type ServiceArea = { city: string; state: string; rationale?: string }
  let serviceAreas = (sa?.service_areas as ServiceArea[] | null) ?? []

  if (serviceAreas.length === 0) {
    // Fall back to AI discovery using geographic_focus + GSC + sitemap context
    const apiKey = agencyRes.data?.ai_api_key as string | null
    if (!apiKey) {
      return NextResponse.json(
        { error: 'No service areas configured and no AI key set. Add service areas in settings or configure AI.' },
        { status: 400 }
      )
    }

    const topQueries = (gscRes.data ?? [])
      .slice(0, 30)
      .map((r: { query: string | null; impressions: number }) => `"${r.query}" (${r.impressions} impr)`)
      .join('\n')

    const geoFocus   = (contentRes.data?.geographic_focus as string | null) ?? ''
    const bizBg      = (contentRes.data?.business_background as string | null) ?? ''
    const alreadyHas = servedCities.slice(0, 20).join(', ') || 'none yet'

    const prompt = `You are a local SEO strategist. A home service business needs new service area landing pages.

Primary service: ${primaryService}
Business: ${bizBg || 'Not provided'}
Primary service area (brand DNA geographic focus): ${geoFocus || 'Not specified'}
Cities that already have live pages — DO NOT include these: ${alreadyHas}

Top GSC queries (last 90 days):
${topQueries || 'No GSC data'}

Task: Suggest 12 NEW target cities for service area pages.

STRICT RULES — follow exactly:
1. Suggest only REAL incorporated cities or towns — NEVER counties, regions, or unincorporated areas.
   BAD examples: "Brevard", "Brevard County", "Central Florida", "Space Coast" — these are NOT cities.
   GOOD examples: "Palm Bay", "Melbourne", "Titusville", "Cocoa", "Rockledge".
2. Every city MUST be in the same county as the primary service area. If the focus is Brevard County, FL,
   every city must be an actual city IN Brevard County. Do NOT suggest cities from adjacent counties
   (e.g. Port Orange is Volusia County — wrong).
3. Do NOT repeat any city from the "already have live pages" list above.
4. Each city must be a place a home service business would realistically travel to.

For each suggestion include a one-sentence rationale.

Return ONLY valid JSON array, no markdown:
[{"city":"Melbourne","state":"FL","rationale":"Second largest city in Brevard County, high residential density for landscaping"},...]`

    let aiError = ''
    try {
      const provider = (agencyRes.data?.ai_provider as string | null) || 'anthropic'
      const model    = (agencyRes.data?.ai_model    as string | null) || (provider === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'gpt-4o-mini')
      let rawText = ''

      if (provider === 'anthropic') {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
        })
        if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`)
        const d = await res.json() as { content?: { text: string }[] }
        rawText = d.content?.[0]?.text ?? ''
      } else {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 1500 }),
        })
        if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`)
        const d = await res.json() as { choices?: { message: { content: string } }[] }
        rawText = d.choices?.[0]?.message?.content ?? ''
      }

      const match = rawText.match(/\[[\s\S]*\]/)
      if (match) serviceAreas = JSON.parse(match[0]) as ServiceArea[]
      else aiError = `Unexpected AI format: ${rawText.slice(0, 200)}`
    } catch (err) {
      aiError = String(err)
      console.error('[SA calendar/generate] AI error:', aiError)
    }

    if (serviceAreas.length === 0) {
      return NextResponse.json(
        { error: `Could not determine target locations. ${aiError || 'Add service areas manually in settings.'}` },
        { status: 400 }
      )
    }
  }

  // ── Compute publish slots ──────────────────────────────────────────────────
  const slots = computeSlots({ anchor, weeksAhead, frequency, dayOfWeek })
  if (slots.length === 0) {
    return NextResponse.json({ error: 'No publish slots computed for the given schedule' }, { status: 400 })
  }

  // ── Create topics, skipping duplicates ─────────────────────────────────────
  const toInsert: {
    client_id: string; content_type: string
    city: string; state_abbr: string; service_name: string
    topic: string; rationale: string | null; status: string; target_publish_date: string
  }[] = []
  let skipped = 0

  let areaIndex = 0
  for (const slot of slots) {
    for (let p = 0; p < pagesPerRun; p++) {
      let placed = false
      let attempts = 0
      while (!placed && attempts < serviceAreas.length) {
        const area = serviceAreas[areaIndex % serviceAreas.length]
        areaIndex++
        attempts++

        const key = comboKey(area.city, area.state, primaryService)
        if (existingCombos.has(key)) {
          skipped++
          continue
        }

        existingCombos.add(key)
        toInsert.push({
          client_id,
          content_type:        'service_area',
          city:                area.city,
          state_abbr:          area.state,
          service_name:        primaryService,
          topic:               `${primaryService} in ${area.city}, ${area.state}`,
          rationale:           (area as ServiceArea & { rationale?: string }).rationale ?? null,
          status:              'pending',
          target_publish_date: slot,
        })
        placed = true
      }
    }
  }

  if (toInsert.length === 0) {
    return NextResponse.json(
      { error: `All target locations already have live pages or are queued (${skipped} skipped). Add more service areas or generate new ones.` },
      { status: 400 }
    )
  }

  const { error } = await db.from('content_topics').insert(toInsert)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, count: toInsert.length, skipped, slots })
}

// ── Slot computation ───────────────────────────────────────────────────────────

function toIso(d: Date): string { return d.toISOString().slice(0, 10) }
function daysInMonth(y: number, m: number): number { return new Date(y, m + 1, 0).getDate() }

function computeSlots(p: { anchor: Date; weeksAhead: number; frequency: string; dayOfWeek: number }): string[] {
  const { anchor, weeksAhead, frequency, dayOfWeek } = p
  const end   = new Date(anchor.getTime() + weeksAhead * 7 * 86_400_000)
  const slots: string[] = []

  if (frequency === 'daily') {
    let c = new Date(anchor)
    while (c <= end) { slots.push(toIso(c)); c = new Date(c.getTime() + 86_400_000) }
    return slots
  }
  if (frequency === 'weekly' || frequency === 'biweekly') {
    const iv = frequency === 'biweekly' ? 14 : 7
    let c = new Date(anchor.getTime() + ((dayOfWeek - anchor.getDay() + 7) % 7) * 86_400_000)
    while (c <= end) { slots.push(toIso(c)); c = new Date(c.getTime() + iv * 86_400_000) }
    return slots
  }
  if (frequency === 'monthly') {
    const td = anchor.getDate()
    let y = anchor.getFullYear(), m = anchor.getMonth()
    for (;;) {
      const cand = new Date(y, m, Math.min(td, daysInMonth(y, m)))
      if (cand > end) break
      if (cand >= anchor) slots.push(toIso(cand))
      m++; if (m > 11) { m = 0; y++ }
    }
    return slots
  }
  // fallback biweekly
  let c = new Date(anchor)
  while (c <= end) { slots.push(toIso(c)); c = new Date(c.getTime() + 14 * 86_400_000) }
  return slots
}
