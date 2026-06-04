// POST /api/admin/content/service-area/calendar/generate
// Generates scheduled service area topics across a content calendar window.
// Mirrors the blog calendar/generate endpoint but reads from service_area_settings
// and cycles through the configured service_areas list (city/state combos).
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

  // ── Load service area schedule config ──────────────────────────────────────
  const { data: sa } = await db
    .from('service_area_settings')
    .select('schedule_frequency, schedule_day_of_week, pages_per_run, service_areas, primary_service')
    .eq('client_id', client_id)
    .maybeSingle()

  const frequency   = (sa?.schedule_frequency   as string  | null) ?? 'monthly'
  const dayOfWeek   = (sa?.schedule_day_of_week  as number  | null) ?? 1
  const pagesPerRun = (sa?.pages_per_run         as number  | null) ?? 1
  const weeksAhead  = weeksAheadParam ?? 8
  const anchor      = start_date ? new Date(start_date) : new Date()

  type ServiceArea = { city: string; state: string }
  const serviceAreas = (sa?.service_areas as ServiceArea[] | null) ?? []
  const primaryService = (sa?.primary_service as string | null) ?? 'Service'

  if (serviceAreas.length === 0) {
    return NextResponse.json(
      { error: 'No service areas configured. Add locations in the service area settings first.' },
      { status: 400 }
    )
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
