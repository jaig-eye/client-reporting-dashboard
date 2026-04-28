// ─────────────────────────────────────────────────────────────────────────────
// GoHighLevel CRM Connector
//
// Auth: { api_key: string }   Config: { location_id: string }
// External ID: the GHL location ID
//
// Fetches: contacts created, calls, form submissions, emails, SMS, reviews per day
// ─────────────────────────────────────────────────────────────────────────────

import type { ConnectorAdapter, SyncResult, DiscoveredAccount } from './types'

const BASE_URL = 'https://services.leadconnectorhq.com'

// Conversation channel types (thread-level, used on /conversations/search objects)
// TYPE_PHONE covers inbound/outbound calls; others cover the channel.
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

/** Raw GHL metric row — one per day. */
export interface GhlRawRow {
  date: string
  contacts_created: number
  total_calls:      number
  missed_calls:     number
  forms_submitted:  number
  reviews_sent:     number
  reviews_received: number
  spam_leads:       number
  emails_sent:      number
  sms_sent:         number
  raw_data:         Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * GHL date fields can be ISO strings OR Unix timestamps (number or numeric string).
 * Handles all three: ISO string, 13-digit ms number, 10-digit second number.
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

/**
 * Paginate GET /contacts/ using meta.startAfter + meta.startAfterId cursors.
 * No server-side date filter — fetch all, filter client-side by dateAdded.
 */
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

  return all
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
  const contacts = await paginateContacts(apiKey, locationId)

  const fromMs = new Date(dateFrom + 'T00:00:00Z').getTime()
  const toMs   = new Date(dateTo   + 'T23:59:59Z').getTime()

  const byDate = new Map<string, { count: number; spam: number }>()
  for (const c of contacts) {
    const parsed = parseGhlDate(c.dateAdded ?? c.createdAt)
    if (!parsed || parsed.ts < fromMs || parsed.ts > toMs) continue
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
): Promise<{ date: string; totalCalls: number; missedCalls: number; emailsSent: number; smsSent: number }[]> {
  // Conversations API uses version 2021-04-15 and startAfterDate cursor pagination.
  // lastMessageDate is often a Unix ms timestamp (not ISO string) — use parseGhlDate everywhere.
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
        // Log raw sample to verify date format and type field
        const sample = items[0] as Record<string, unknown>
        console.log('[ghl] sample conversation fields:', {
          type: sample.type,
          lastMessageDate: sample.lastMessageDate,
          dateAdded: sample.dateAdded,
          unreadCount: sample.unreadCount,
        })
      }

      if (items.length === 0) break

      // Stop when oldest conversation's lastMessageDate is before our range
      const oldest      = items[items.length - 1] as Record<string, unknown>
      const oldestParsed = parseGhlDate(oldest.lastMessageDate ?? oldest.dateUpdated ?? oldest.dateAdded)
      if (oldestParsed && oldestParsed.ts < fromMs) break
      if (items.length < 100) break

      // startAfterDate cursor must be an ISO string for the API
      startAfterDate = oldestParsed?.iso ?? ''
      if (!startAfterDate) break
    }
  } catch (e) {
    console.log(`[ghl] conversations/search failed: ${String(e)}`)
    return []
  }

  const toMs = new Date(dateTo + 'T23:59:59Z').getTime()

  const typeCounts: Record<string, number> = {}
  const allTypeCounts: Record<string, number> = {}
  const byDate = new Map<string, { totalCalls: number; missedCalls: number; emailsSent: number; smsSent: number }>()

  for (const conv of all) {
    const typ = String(conv.type || '').toUpperCase()
    allTypeCounts[typ] = (allTypeCounts[typ] ?? 0) + 1

    // Use lastMessageDate for when the activity happened, not dateAdded (thread creation)
    const parsed = parseGhlDate(conv.lastMessageDate ?? conv.dateUpdated ?? conv.dateAdded ?? conv.createdAt)
    if (!parsed || parsed.ts < fromMs || parsed.ts > toMs) continue

    typeCounts[typ] = (typeCounts[typ] ?? 0) + 1
    const ex = byDate.get(parsed.date) ?? { totalCalls: 0, missedCalls: 0, emailsSent: 0, smsSent: 0 }

    if (CALL_TYPES.has(typ)) {
      ex.totalCalls++
      const unread = Number(conv.unreadCount ?? 0)
      if (unread > 0) ex.missedCalls++
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

async function fetchFormSubmissions(
  apiKey: string,
  locationId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ date: string; count: number }[]> {
  let forms: Record<string, unknown>[] = []
  try {
    let skip = 0
    for (;;) {
      const data  = await ghlGet('/forms/', apiKey, { locationId, limit: '50', skip: String(skip) })
      const batch = (data.forms as Record<string, unknown>[]) ?? []
      forms.push(...batch)
      if (batch.length < 50) break
      skip += 50
    }
  } catch {
    return []
  }

  const byDate = new Map<string, number>()

  for (const form of forms) {
    const formId = String(form.id || '')
    if (!formId) continue

    try {
      let pg = 1
      for (;;) {
        const data = await ghlGet('/forms/submissions', apiKey, {
          locationId,
          formId,
          limit:   '100',
          page:    String(pg),
          startAt: dateFrom,
          endAt:   dateTo,
        })
        const subs = (data.submissions as Record<string, unknown>[]) ?? []
        for (const sub of subs) {
          const parsed = parseGhlDate(sub.createdAt ?? sub.dateAdded)
          if (!parsed) continue
          byDate.set(parsed.date, (byDate.get(parsed.date) ?? 0) + 1)
        }
        if (subs.length < 100) break
        pg++
        await sleep(200)
      }
    } catch {
      // Skip this form on error
    }
    await sleep(300)
  }

  return Array.from(byDate.entries()).map(([date, count]) => ({ date, count }))
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
      await sleep(200)
    }
  } catch {
    // Reviews endpoint may not be available on all plans
  }

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
      // Sequential to avoid burst rate limits
      const contactData = await fetchContacts(apiKey, locationId, dateFrom, dateTo)
      console.log(`[ghl] contacts in range: ${contactData.reduce((s, d) => s + d.count, 0)} across ${contactData.length} days`)

      const convData  = await fetchConversations(apiKey, locationId, dateFrom, dateTo)
      const formData  = await fetchFormSubmissions(apiKey, locationId, dateFrom, dateTo)
      const reviewData = await fetchReviews(apiKey, locationId, dateFrom, dateTo)
      console.log(`[ghl] forms: ${formData.reduce((s, d) => s + d.count, 0)}, reviews: ${reviewData.reduce((s, d) => s + d.received, 0)}`)

      const allDates    = dateRange(dateFrom, dateTo)
      const contactMap  = new Map(contactData.map(d  => [d.date, d]))
      const convMap     = new Map(convData.map(d     => [d.date, d]))
      const formMap     = new Map(formData.map(d     => [d.date, d]))
      const reviewMap   = new Map(reviewData.map(d   => [d.date, d]))

      const rows: GhlRawRow[] = allDates.map(date => {
        const c = contactMap.get(date)
        const v = convMap.get(date)
        const f = formMap.get(date)
        const rv = reviewMap.get(date)
        return {
          date,
          contacts_created: c?.count           ?? 0,
          total_calls:      v?.totalCalls       ?? 0,
          missed_calls:     v?.missedCalls      ?? 0,
          forms_submitted:  f?.count            ?? 0,
          reviews_sent:     0,
          reviews_received: rv?.received        ?? 0,
          spam_leads:       c?.spam             ?? 0,
          emails_sent:      v?.emailsSent       ?? 0,
          sms_sent:         v?.smsSent          ?? 0,
          raw_data:         {},
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
