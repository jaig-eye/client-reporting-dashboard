// ─────────────────────────────────────────────────────────────────────────────
// GoHighLevel CRM Connector
//
// Auth: { api_key: string }   Config: { location_id: string }
// External ID: the GHL location ID
//
// Fetches per day: contacts created, calls, forms+surveys submitted,
//                  opportunities (new/won/lost + won value), reviews
// ─────────────────────────────────────────────────────────────────────────────

import type { ConnectorAdapter, SyncResult, DiscoveredAccount } from './types'

const BASE_URL = 'https://services.leadconnectorhq.com'

// Conversation channel types (thread-level) + message action types (message-level)
const CALL_TYPES  = new Set([
  'TYPE_PHONE',                                                              // conversation channel
  'TYPE_CALL', 'TYPE_IVR_CALL', 'TYPE_CUSTOM_CALL', 'TYPE_CAMPAIGN_CALL',  // message action types
])
const EMAIL_TYPES = new Set([
  'TYPE_EMAIL', 'TYPE_CUSTOM_EMAIL', 'TYPE_CAMPAIGN_EMAIL', 'TYPE_CUSTOM_PROVIDER_EMAIL',
])
const SMS_TYPES   = new Set([
  'TYPE_SMS', 'TYPE_CUSTOM_SMS', 'TYPE_CAMPAIGN_SMS', 'TYPE_CUSTOM_PROVIDER_SMS',
  'TYPE_SMS_REVIEW_REQUEST', 'TYPE_SMS_NO_SHOW_REQUEST',
])

export interface FormBreakdownItem {
  id:    string
  name:  string
  type:  'form' | 'survey' | 'booking'
  count: number
}

/** Raw GHL metric row — one per day. */
export interface GhlRawRow {
  date:               string
  contacts_created:   number
  total_calls:        number
  incoming_calls:     number
  outgoing_calls:     number
  missed_calls:       number
  forms_submitted:    number
  reviews_sent:       number
  reviews_received:   number
  spam_leads:         number
  emails_sent:        number
  sms_sent:           number
  new_opportunities:  number
  won_opportunities:  number
  lost_opportunities: number
  won_value:          number
  raw_data:           Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * GHL date fields can be ISO strings OR Unix timestamps (number or numeric string).
 */
function parseGhlDate(val: unknown): { ts: number; iso: string; date: string } | null {
  if (val == null) return null
  let ts: number
  if (typeof val === 'number') {
    ts = val > 9_999_999_999 ? val : val * 1_000
  } else {
    const s = String(val).trim()
    if (!s) return null
    if (/^\d{13}$/.test(s))      ts = Number(s)
    else if (/^\d{10}$/.test(s)) ts = Number(s) * 1_000
    else                          ts = new Date(s).getTime()
  }
  if (!isFinite(ts)) return null
  const iso  = new Date(ts).toISOString()
  const date = iso.split('T')[0]
  return { ts, iso, date }
}

function dateRange(from: string, to: string): string[] {
  const dates: string[] = []
  const d   = new Date(from)
  const end = new Date(to)
  while (d <= end) {
    dates.push(d.toISOString().split('T')[0])
    d.setDate(d.getDate() + 1)
  }
  return dates
}

// ─────────────────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────────────────

async function ghlGet(
  path: string,
  apiKey: string,
  params: Record<string, string> = {},
  maxRetries = 4,
  version = '2021-07-28'
): Promise<Record<string, unknown>> {
  const url = new URL(`${BASE_URL}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  let delay = 5_000
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Version:        version,
      },
    })
    if (res.ok) return res.json() as Promise<Record<string, unknown>>

    const text = await res.text()
    if (res.status === 429 && attempt < maxRetries) {
      const retryAfter = res.headers.get('Retry-After')
      const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : delay
      console.log(`[ghl] 429 — waiting ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`)
      await sleep(waitMs)
      delay = Math.min(delay * 2, 60_000)
      continue
    }
    throw new Error(`GHL API error ${res.status}: ${text}`)
  }
  throw new Error('GHL API: max retries exceeded')
}

async function ghlPost(
  path: string,
  apiKey: string,
  body: Record<string, unknown>,
  maxRetries = 4,
  version = '2021-07-28'
): Promise<Record<string, unknown>> {
  const url = `${BASE_URL}${path}`
  let delay = 5_000
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Version:        version,
      },
      body: JSON.stringify(body),
    })
    if (res.ok) return res.json() as Promise<Record<string, unknown>>
    const text = await res.text()
    if (res.status === 429 && attempt < maxRetries) {
      const retryAfter = res.headers.get('Retry-After')
      const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : delay
      await sleep(waitMs)
      delay = Math.min(delay * 2, 60_000)
      continue
    }
    throw new Error(`GHL API error ${res.status}: ${text}`)
  }
  throw new Error('GHL API: max retries exceeded')
}

// Server-side date-filtered contact search — avoids fetching all contacts and discarding in memory.
// Falls back to full pagination if the search endpoint returns an unexpected format.
async function searchContactsByDate(
  apiKey: string,
  locationId: string,
  dateFrom: string,
  dateTo: string
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = []
  let page = 1

  for (let i = 0; i < 50; i++) {
    const data = await ghlPost('/contacts/search', apiKey, {
      locationId,
      page,
      pageLimit: 100,
      filters: [
        { field: 'dateAdded', operator: '>=', value: new Date(dateFrom + 'T00:00:00Z').toISOString() },
        { field: 'dateAdded', operator: '<=', value: new Date(dateTo   + 'T23:59:59Z').toISOString() },
      ],
      sort: [{ field: 'dateAdded', direction: 'asc' }],
    })

    const contacts = (data.contacts as Record<string, unknown>[]) ?? []
    all.push(...contacts)
    if (contacts.length < 100) break
    page++
  }

  const seen = new Set<string>()
  return all.filter(c => {
    const id = String(c.id || c.contactId || '')
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

async function paginateContacts(
  apiKey: string,
  locationId: string
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = []
  let startAfter:   string | undefined
  let startAfterId: string | undefined

  for (let page = 0; page < 100; page++) {
    const p: Record<string, string> = { locationId, limit: '100' }
    if (startAfter)   p.startAfter   = startAfter
    if (startAfterId) p.startAfterId = startAfterId

    const data  = await ghlGet('/contacts/', apiKey, p)
    const items = (data.contacts as Record<string, unknown>[]) ?? []
    all.push(...items)

    const meta = data.meta as Record<string, unknown> | undefined
    const nextStartAfter   = meta?.startAfter   != null ? String(meta.startAfter)   : undefined
    const nextStartAfterId = meta?.startAfterId != null ? String(meta.startAfterId) : undefined

    if (!nextStartAfter && !nextStartAfterId) break
    if (items.length < 100) break
    startAfter   = nextStartAfter
    startAfterId = nextStartAfterId
  }

  const seen = new Set<string>()
  return all.filter(c => {
    const id = String((c as Record<string, unknown>).id || (c as Record<string, unknown>).contactId || '')
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics fetching
// ─────────────────────────────────────────────────────────────────────────────

async function fetchContacts(
  apiKey: string,
  locationId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ date: string; count: number; spam: number }[]> {
  let contacts: Record<string, unknown>[]
  try {
    contacts = await searchContactsByDate(apiKey, locationId, dateFrom, dateTo)
    console.log(`[ghl] contacts (search endpoint): ${contacts.length} in range`)
  } catch (searchErr) {
    console.warn(`[ghl] contacts search fallback to pagination: ${String(searchErr)}`)
    contacts = await paginateContacts(apiKey, locationId)
  }

  const fromMs = new Date(dateFrom + 'T00:00:00Z').getTime()
  const toMs   = new Date(dateTo   + 'T23:59:59Z').getTime()

  const byDate = new Map<string, { count: number; spam: number }>()
  for (const c of contacts) {
    const parsed = parseGhlDate(c.dateAdded ?? c.createdAt)
    if (!parsed || parsed.ts < fromMs || parsed.ts > toMs) continue
    if (c.archived === true || c.deleted === true) continue
    const ex   = byDate.get(parsed.date) ?? { count: 0, spam: 0 }
    ex.count++
    const tags = (c.tags as string[]) ?? []
    if (tags.some(t => t.toLowerCase().includes('spam'))) ex.spam++
    byDate.set(parsed.date, ex)
  }

  return Array.from(byDate.entries()).map(([date, v]) => ({ date, ...v }))
}

async function fetchConversations(
  apiKey: string,
  locationId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ date: string; totalCalls: number; incomingCalls: number; outgoingCalls: number; missedCalls: number; emailsSent: number; smsSent: number }[]> {
  const all: Record<string, unknown>[] = []
  let startAfterDate: string | undefined
  const fromMs = new Date(dateFrom + 'T00:00:00Z').getTime()

  try {
    for (let page = 0; page < 100; page++) {
      const p: Record<string, string> = {
        locationId,
        limit:  '100',
        sortBy: 'last_message_date',
        sort:   'desc',
      }
      if (startAfterDate) p.startAfterDate = startAfterDate

      const data  = await ghlGet('/conversations/search', apiKey, p, 4, '2021-04-15')
      const items = (data.conversations as Record<string, unknown>[]) ?? []
      all.push(...items)

      console.log(`[ghl] conversations page ${page + 1}: ${items.length} items (total ${all.length})`)
      if (page === 0 && items.length > 0) {
        const sample = items[0] as Record<string, unknown>
        console.log('[ghl] sample conversation fields:', {
          type: sample.type,
          lastMessageDate: sample.lastMessageDate,
          dateAdded: sample.dateAdded,
          direction: sample.direction,
          lastMessageType: sample.lastMessageType,
          unreadCount: sample.unreadCount,
        })
      }

      if (items.length === 0) break

      const oldest       = items[items.length - 1] as Record<string, unknown>
      const oldestParsed = parseGhlDate(oldest.lastMessageDate ?? oldest.dateUpdated ?? oldest.dateAdded)
      if (oldestParsed && oldestParsed.ts < fromMs) break
      if (items.length < 100) break

      const rawCursor = oldest.lastMessageDate ?? oldest.dateUpdated ?? oldest.dateAdded
      startAfterDate  = rawCursor != null ? String(rawCursor) : ''
      if (!startAfterDate) break
    }
  } catch (e) {
    console.log(`[ghl] conversations/search failed: ${String(e)}`)
    return []
  }

  const toMs = new Date(dateTo + 'T23:59:59Z').getTime()

  const typeCounts: Record<string, number> = {}
  const allTypeCounts: Record<string, number> = {}
  const byDate = new Map<string, { totalCalls: number; incomingCalls: number; outgoingCalls: number; missedCalls: number; emailsSent: number; smsSent: number }>()

  // Deduplicate by conversation ID — cursor pagination keyed on lastMessageDate can
  // return the same conversation on two pages when a message arrives mid-pagination.
  const convSeen = new Set<string>()
  const deduped = all.filter(c => {
    const id = String((c as Record<string, unknown>).id || '')
    if (!id || convSeen.has(id)) return false
    convSeen.add(id)
    return true
  })

  for (const conv of deduped) {
    const typ = String(conv.type || '').toUpperCase()
    allTypeCounts[typ] = (allTypeCounts[typ] ?? 0) + 1

    // Use dateAdded (when the conversation/call was created) not lastMessageDate
    // (when the most recent message was sent). lastMessageDate is updated whenever
    // anyone replies to an old thread, causing old calls to be counted in the current period.
    const parsed = parseGhlDate(conv.dateAdded ?? conv.createdAt ?? conv.lastMessageDate)
    if (!parsed || parsed.ts < fromMs || parsed.ts > toMs) continue

    typeCounts[typ] = (typeCounts[typ] ?? 0) + 1
    const ex = byDate.get(parsed.date) ?? { totalCalls: 0, incomingCalls: 0, outgoingCalls: 0, missedCalls: 0, emailsSent: 0, smsSent: 0 }

    if (CALL_TYPES.has(typ)) {
      const direction = String(conv.direction || '').toLowerCase()
      const isInbound = direction === 'inbound' || direction === ''
      ex.totalCalls++
      if (isInbound) ex.incomingCalls++
      else           ex.outgoingCalls++
      const lastMsgType = String(conv.lastMessageType || '').toUpperCase()
      if (isInbound && (lastMsgType === 'TYPE_MISSED_CALL' || lastMsgType.includes('MISSED'))) ex.missedCalls++
    } else if (EMAIL_TYPES.has(typ)) {
      ex.emailsSent++
    } else if (SMS_TYPES.has(typ)) {
      ex.smsSent++
    }
    byDate.set(parsed.date, ex)
  }

  console.log(`[ghl] all conversation types (${all.length} total):`, allTypeCounts)
  console.log(`[ghl] in-range conversation types (${dateFrom}–${dateTo}):`, typeCounts)

  return Array.from(byDate.entries()).map(([date, v]) => ({ date, ...v }))
}

type FormsResult = {
  rows:     { date: string; count: number; breakdown: FormBreakdownItem[] }[]
  // totalBreakdown is the aggregate across all days — identical to summing rows[*].breakdown by id
  totalBreakdown: FormBreakdownItem[]
}

/** Fetches forms, surveys, and bookings — returning per-day counts + per-item breakdown. */
async function fetchFormsAndSurveys(
  apiKey: string,
  locationId: string,
  dateFrom: string,
  dateTo: string
): Promise<FormsResult> {
  // ── 1. Collect all form/survey/booking items ─────────────────────────────────
  type Item = { id: string; name: string; type: 'form' | 'survey' | 'booking' }
  const items: Item[] = []

  // Forms
  try {
    let skip = 0
    for (;;) {
      const data  = await ghlGet('/forms/', apiKey, { locationId, limit: '50', skip: String(skip) })
      const batch = (data.forms as Record<string, unknown>[]) ?? []
      for (const f of batch) items.push({ id: String(f.id || ''), name: String(f.name || f.title || f.id || ''), type: 'form' })
      if (batch.length < 50) break
      skip += 50
    }
  } catch { /* continue */ }

  // Surveys
  try {
    let skip = 0
    for (;;) {
      const data  = await ghlGet('/surveys/', apiKey, { locationId, limit: '50', skip: String(skip) })
      const batch = (data.surveys as Record<string, unknown>[]) ?? []
      for (const s of batch) items.push({ id: String(s.id || ''), name: String(s.name || s.title || s.id || ''), type: 'survey' })
      if (batch.length < 50) break
      skip += 50
    }
  } catch (e) {
    if (String(e).includes('401')) console.log('[ghl] surveys: missing scope — add "surveys.readonly" to your private integration')
  }

  console.log(`[ghl] forms/surveys: ${items.filter(i => i.type === 'form').length} forms, ${items.filter(i => i.type === 'survey').length} surveys`)

  // ── 2. Fetch submissions per item ────────────────────────────────────────────
  // byDate: date → { total, perItem: itemId → count }
  const byDate = new Map<string, { total: number; perItem: Map<string, number> }>()

  // Fetch all form/survey items in parallel batches of 20.
  // GHL burst limit is 100 req/10s; ghlGet handles 429s with backoff.
  const SUBMISSION_CONCURRENCY = 20
  for (let i = 0; i < items.length; i += SUBMISSION_CONCURRENCY) {
    await Promise.allSettled(items.slice(i, i + SUBMISSION_CONCURRENCY).map(async (item) => {
      if (!item.id) return
      const submissionKey = item.type === 'form' ? 'formId' : 'surveyId'
      const subPath       = item.type === 'form' ? '/forms/submissions' : '/surveys/submissions'

      let pg = 1
      for (;;) {
        const data = await ghlGet(subPath, apiKey, {
          locationId,
          [submissionKey]: item.id,
          limit:   '100',
          page:    String(pg),
          startAt: dateFrom,
          endAt:   dateTo,
        })
        const subs = (data.submissions as Record<string, unknown>[]) ?? []

        for (const sub of subs) {
          const parsed = parseGhlDate(sub.createdAt ?? sub.dateAdded ?? sub.submittedAt)
          if (!parsed) continue
          const day = byDate.get(parsed.date) ?? { total: 0, perItem: new Map() }
          day.total++
          day.perItem.set(item.id, (day.perItem.get(item.id) ?? 0) + 1)
          byDate.set(parsed.date, day)
        }

        if (subs.length < 100) break
        pg++
      }
    }))
  }

  // ── 3. Bookings (calendar appointments) ─────────────────────────────────────
  // Appointments are counted per calendar. We fetch all calendars first, then
  // query events for each. startTime/endTime use epoch ms.
  try {
    const fromMs = new Date(dateFrom + 'T00:00:00Z').getTime()
    const toMs   = new Date(dateTo   + 'T23:59:59Z').getTime()

    // List all calendars for location
    const calData  = await ghlGet('/calendars/', apiKey, { locationId })
    const calendars = (calData.calendars as Record<string, unknown>[]) ?? []

    // Pre-register all booking keys before parallel fetch so items map is complete
    for (const cal of calendars) {
      const calId   = String(cal.id   || '')
      const calName = String(cal.name || cal.id || '')
      if (calId) items.push({ id: `booking:${calId}`, name: calName, type: 'booking' })
    }

    // Fetch all calendars in parallel — no pre-emptive sleep, ghlGet handles 429s
    await Promise.allSettled(calendars.map(async (cal) => {
      const calId = String(cal.id || '')
      if (!calId) return
      const bookingKey = `booking:${calId}`

      let skip = 0
      for (;;) {
        const data = await ghlGet('/calendars/events', apiKey, {
          locationId,
          calendarId: calId,
          startTime:  String(fromMs),
          endTime:    String(toMs),
          limit:      '100',
          skip:       String(skip),
        })
        const events = (data.events as Record<string, unknown>[]) ?? []

        for (const ev of events) {
          // Count by when the appointment was booked (createdAt), not when it occurs
          const parsed = parseGhlDate(ev.dateAdded ?? ev.createdAt ?? ev.startTime)
          if (!parsed) continue
          const day = byDate.get(parsed.date) ?? { total: 0, perItem: new Map() }
          day.total++
          day.perItem.set(bookingKey, (day.perItem.get(bookingKey) ?? 0) + 1)
          byDate.set(parsed.date, day)
        }

        if (events.length < 100) break
        skip += 100
      }
    }))
    console.log(`[ghl] bookings: ${calendars.length} calendars queried`)
  } catch (e) {
    if (String(e).includes('401')) {
      console.log('[ghl] bookings: missing scope — add "calendars.readonly" to your private integration')
    } else {
      console.log(`[ghl] bookings fetch failed: ${String(e)}`)
    }
  }

  // ── 4. Build output ──────────────────────────────────────────────────────────
  // Build item name+type map for quick lookup
  const itemMeta = new Map(items.map(i => [i.id, { name: i.name, type: i.type }]))

  // Aggregate breakdown across all days
  const totalPerItem = new Map<string, number>()
  for (const day of Array.from(byDate.values())) {
    for (const [id, count] of Array.from(day.perItem.entries())) {
      totalPerItem.set(id, (totalPerItem.get(id) ?? 0) + count)
    }
  }

  const totalBreakdown: FormBreakdownItem[] = Array.from(totalPerItem.entries())
    .map(([id, count]) => ({ id, name: itemMeta.get(id)?.name ?? id, type: (itemMeta.get(id)?.type ?? 'form') as 'form' | 'survey' | 'booking', count }))
    .sort((a, b) => b.count - a.count)

  const rows = Array.from(byDate.entries()).map(([date, { total, perItem }]) => ({
    date,
    count: total,
    breakdown: Array.from(perItem.entries())
      .map(([id, count]) => ({ id, name: itemMeta.get(id)?.name ?? id, type: (itemMeta.get(id)?.type ?? 'form') as 'form' | 'survey' | 'booking', count }))
      .sort((a, b) => b.count - a.count),
  }))

  console.log(`[ghl] form/survey total submissions: ${totalBreakdown.reduce((s, i) => s + i.count, 0)}`)
  return { rows, totalBreakdown }
}

// Single paginated pass for all opportunity types.
// Sorts by updatedAt_desc so both new opps (dateAdded) and closed opps (closedDate)
// are reachable. Results are split client-side by status, eliminating the second pass.
async function fetchAllOpportunities(
  apiKey: string,
  locationId: string,
  dateFrom: string,
  dateTo: string
): Promise<{
  oppData:       { date: string; newOpps: number }[]
  closedOppData: { date: string; wonOpps: number; lostOpps: number; wonValue: number }[]
}> {
  const fromMs = new Date(dateFrom + 'T00:00:00Z').getTime()
  const toMs   = new Date(dateTo   + 'T23:59:59Z').getTime()
  const all: Record<string, unknown>[] = []

  try {
    let startAfter:   string | undefined
    let startAfterId: string | undefined

    for (let page = 0; page < 200; page++) {
      const p: Record<string, string> = {
        location_id: locationId,
        limit:       '100',
        order:       'updatedAt_desc',
      }
      if (startAfter)   p.startAfter   = startAfter
      if (startAfterId) p.startAfterId = startAfterId

      const data = await ghlGet('/opportunities/search', apiKey, p)
      const opps = (data.opportunities as Record<string, unknown>[]) ?? []
      all.push(...opps)

      if (opps.length === 0) break

      // Stop when both dateAdded and updatedAt of the oldest item are before range
      const oldest = opps[opps.length - 1] as Record<string, unknown>
      const oldestUpdated = parseGhlDate(oldest.updatedAt ?? oldest.dateAdded)
      const oldestCreated = parseGhlDate(oldest.dateAdded ?? oldest.createdAt)
      if (
        oldestUpdated && oldestUpdated.ts < fromMs &&
        oldestCreated && oldestCreated.ts < fromMs
      ) break
      if (opps.length < 100) break

      const meta = data.meta as Record<string, unknown> | undefined
      startAfter   = meta?.startAfter   != null ? String(meta.startAfter)   : undefined
      startAfterId = meta?.startAfterId != null ? String(meta.startAfterId) : undefined
      if (!startAfter && !startAfterId) break
    }
  } catch (e) {
    const msg = String(e)
    if (msg.includes('401') || msg.includes('not authorized')) {
      console.log('[ghl] opportunities/search: missing scope — add "opportunities.readonly" to your private integration')
    } else {
      console.log(`[ghl] opportunities/search failed: ${msg}`)
    }
    return { oppData: [], closedOppData: [] }
  }

  const oppSeen = new Set<string>()
  const uniqueOpps = all.filter(o => {
    const id = String((o as Record<string, unknown>).id || '')
    if (!id || oppSeen.has(id)) return false
    oppSeen.add(id)
    return true
  })
  console.log(`[ghl] opportunities fetched: ${all.length}, unique: ${uniqueOpps.length}`)

  if (uniqueOpps.length > 0) {
    const sample = uniqueOpps[0] as Record<string, unknown>
    console.log('[ghl] sample opp fields:', {
      status: sample.status, closedDate: sample.closedDate,
      lastStatusChangeAt: sample.lastStatusChangeAt,
      updatedAt: sample.updatedAt, dateAdded: sample.dateAdded,
    })
  }

  const newByDate    = new Map<string, { newOpps: number }>()
  const closedByDate = new Map<string, { wonOpps: number; lostOpps: number; wonValue: number }>()

  for (const opp of uniqueOpps) {
    const status = String(opp.status || '').toLowerCase()

    // New opportunities: count by creation date
    const createdParsed = parseGhlDate(opp.dateAdded ?? opp.createdAt)
    if (createdParsed && createdParsed.ts >= fromMs && createdParsed.ts <= toMs) {
      const ex = newByDate.get(createdParsed.date) ?? { newOpps: 0 }
      ex.newOpps++
      newByDate.set(createdParsed.date, ex)
    }

    // Won/Lost: count by close date
    if (status === 'won' || status === 'lost') {
      const closeDate   = opp.closedDate ?? opp.lastStatusChangeAt ?? opp.updatedAt
      const closeParsed = parseGhlDate(closeDate)
      if (closeParsed && closeParsed.ts >= fromMs && closeParsed.ts <= toMs) {
        const ex    = closedByDate.get(closeParsed.date) ?? { wonOpps: 0, lostOpps: 0, wonValue: 0 }
        const value = Number(opp.monetaryValue ?? opp.value ?? 0)
        if (status === 'won') { ex.wonOpps++; ex.wonValue += value }
        else                    ex.lostOpps++
        closedByDate.set(closeParsed.date, ex)
      }
    }
  }

  return {
    oppData:       Array.from(newByDate.entries()).map(([date, v]) => ({ date, ...v })),
    closedOppData: Array.from(closedByDate.entries()).map(([date, v]) => ({ date, ...v })),
  }
}

async function fetchReviews(
  apiKey: string,
  locationId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ date: string; received: number }[]> {
  const fromMs = new Date(dateFrom + 'T00:00:00Z').getTime()
  const toMs   = new Date(dateTo   + 'T23:59:59Z').getTime()
  const byDate = new Map<string, number>()

  try {
    let page = 1
    for (;;) {
      const data    = await ghlGet('/reviews/', apiKey, {
        locationId,
        limit:     '100',
        page:      String(page),
        startDate: dateFrom,
        endDate:   dateTo,
      })
      const reviews = (data.reviews as Record<string, unknown>[]) ?? []

      for (const r of reviews) {
        const parsed = parseGhlDate(r.dateAdded ?? r.createdAt ?? r.date)
        if (!parsed || parsed.ts < fromMs || parsed.ts > toMs) continue
        byDate.set(parsed.date, (byDate.get(parsed.date) ?? 0) + 1)
      }

      if (reviews.length < 100) break
      page++
    }
  } catch { /* reviews endpoint may not be available on all plans */ }

  return Array.from(byDate.entries()).map(([date, received]) => ({ date, received }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Connector adapter
// ─────────────────────────────────────────────────────────────────────────────

export const ghlConnector: ConnectorAdapter = {
  type: 'ghl',

  async fetchMetrics(
    externalId: string,
    auth: Record<string, unknown>,
    _config: Record<string, unknown>,
    dateFrom: string,
    dateTo: string
  ): Promise<SyncResult> {
    const apiKey     = String(auth.api_key || '')
    const locationId = externalId

    if (!apiKey || !locationId) {
      return { rows: [], error: 'Missing GHL API key or location ID' }
    }

    try {
      // All fetches are independent — run in parallel. ghlGet handles 429s with backoff.
      const [
        contactData,
        convData,
        formsResult,
        allOppResult,
        reviewData,
      ] = await Promise.all([
        fetchContacts(apiKey, locationId, dateFrom, dateTo),
        fetchConversations(apiKey, locationId, dateFrom, dateTo),
        fetchFormsAndSurveys(apiKey, locationId, dateFrom, dateTo),
        fetchAllOpportunities(apiKey, locationId, dateFrom, dateTo),
        fetchReviews(apiKey, locationId, dateFrom, dateTo),
      ])
      const { oppData, closedOppData } = allOppResult
      console.log(`[ghl] contacts in range: ${contactData.reduce((s, d) => s + d.count, 0)} across ${contactData.length} days`)
      console.log(`[ghl] reviews: ${reviewData.reduce((s, d) => s + d.received, 0)}`)

      const allDates      = dateRange(dateFrom, dateTo)
      const contactMap    = new Map(contactData.map(d       => [d.date, d]))
      const convMap       = new Map(convData.map(d           => [d.date, d]))
      const formMap       = new Map(formsResult.rows.map(d   => [d.date, d]))
      const oppMap        = new Map(oppData.map(d            => [d.date, d]))
      const closedOppMap  = new Map(closedOppData.map(d      => [d.date, d]))
      const reviewMap     = new Map(reviewData.map(d         => [d.date, d]))

      const rows: GhlRawRow[] = allDates.map(date => {
        const c  = contactMap.get(date)
        const v  = convMap.get(date)
        const f  = formMap.get(date)
        const o  = oppMap.get(date)
        const co = closedOppMap.get(date)
        const rv = reviewMap.get(date)
        return {
          date,
          contacts_created:   c?.count            ?? 0,
          total_calls:        v?.totalCalls        ?? 0,
          incoming_calls:     v?.incomingCalls     ?? 0,
          outgoing_calls:     v?.outgoingCalls     ?? 0,
          missed_calls:       v?.missedCalls       ?? 0,
          forms_submitted:    f?.count             ?? 0,
          reviews_sent:       0,
          reviews_received:   rv?.received         ?? 0,
          spam_leads:         c?.spam              ?? 0,
          emails_sent:        v?.emailsSent        ?? 0,
          sms_sent:           v?.smsSent           ?? 0,
          new_opportunities:  o?.newOpps           ?? 0,
          won_opportunities:  co?.wonOpps          ?? 0,
          lost_opportunities: co?.lostOpps         ?? 0,
          won_value:          co?.wonValue         ?? 0,
          raw_data: {
            form_breakdown: f?.breakdown ?? [],
          },
        }
      })

      return { rows: rows as never[] }
    } catch (err) {
      return { rows: [], error: `GHL sync failed: ${String(err)}` }
    }
  },

  async discoverAccounts(
    auth: Record<string, unknown>,
    config: Record<string, unknown>
  ): Promise<DiscoveredAccount[]> {
    const apiKey     = String(auth.api_key || '')
    const locationId = String(config.location_id || '')
    if (!apiKey || !locationId) return []
    try {
      const data = await ghlGet(`/locations/${locationId}`, apiKey)
      const loc  = (data.location ?? data) as Record<string, unknown>
      return [{
        external_id:   locationId,
        external_name: String(loc.name || loc.businessName || locationId),
        metadata:      { address: loc.address, phone: loc.phone },
      }]
    } catch {
      return []
    }
  },

  async testConnection(
    auth: Record<string, unknown>,
    config: Record<string, unknown>
  ): Promise<boolean> {
    const apiKey     = String(auth.api_key || '')
    const locationId = String(config.location_id || '')
    if (!apiKey || !locationId) return false
    try {
      await ghlGet(`/locations/${locationId}`, apiKey)
      return true
    } catch {
      return false
    }
  },
}
