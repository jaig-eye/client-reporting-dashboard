// ─────────────────────────────────────────────────────────────────────────────
// GoHighLevel CRM Connector
//
// Auth: { api_key: string }   Config: { location_id: string }
// External ID: the GHL location ID
//
// Fetches: contacts created, calls, form submissions, emails, SMS per day
// ─────────────────────────────────────────────────────────────────────────────

import type { ConnectorAdapter, SyncResult, DiscoveredAccount } from './types'

const BASE_URL = 'https://services.leadconnectorhq.com'

// GHL type-prefix constants for conversations
const CALL_TYPES  = new Set(['TYPE_CALL', 'TYPE_IVR_CALL', 'TYPE_CUSTOM_CALL', 'TYPE_CAMPAIGN_CALL'])
const EMAIL_TYPES = new Set(['TYPE_EMAIL', 'TYPE_CUSTOM_EMAIL', 'TYPE_CAMPAIGN_EMAIL', 'TYPE_CUSTOM_PROVIDER_EMAIL'])
const SMS_TYPES   = new Set(['TYPE_SMS', 'TYPE_CUSTOM_SMS', 'TYPE_CAMPAIGN_SMS', 'TYPE_CUSTOM_PROVIDER_SMS',
                              'TYPE_SMS_REVIEW_REQUEST', 'TYPE_SMS_NO_SHOW_REQUEST'])

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
// API helpers
// ─────────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

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
 * The contacts endpoint has no server-side date filter, so we fetch all and
 * filter client-side by dateAdded.
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

    // Use meta cursors for next page
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
  // No server-side date filter on GET /contacts/ — fetch all, group client-side
  const contacts = await paginateContacts(apiKey, locationId)

  const fromMs = new Date(dateFrom + 'T00:00:00Z').getTime()
  const toMs   = new Date(dateTo   + 'T23:59:59Z').getTime()

  const byDate = new Map<string, { count: number; spam: number }>()
  for (const c of contacts) {
    const created = String(c.dateAdded || c.createdAt || '')
    if (!created) continue
    const ts = new Date(created).getTime()
    if (ts < fromMs || ts > toMs) continue   // outside requested range

    const date = created.split('T')[0]
    if (!date) continue
    const ex = byDate.get(date) ?? { count: 0, spam: 0 }
    ex.count++
    const tags = (c.tags as string[]) ?? []
    if (tags.some(t => t.toLowerCase().includes('spam'))) ex.spam++
    byDate.set(date, ex)
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
  // Sorted by last_message_date desc — use that field (not dateAdded) for date attribution.
  const all: Record<string, unknown>[] = []
  let startAfterDate: string | undefined

  try {
    for (let page = 0; page < 100; page++) {
      const p: Record<string, string> = {
        locationId,
        limit:   '100',
        sortBy:  'last_message_date',
        sort:    'desc',
      }
      if (startAfterDate) p.startAfterDate = startAfterDate

      const data  = await ghlGet('/conversations/search', apiKey, p, 4, '2021-04-15')
      const items = (data.conversations as Record<string, unknown>[]) ?? []
      all.push(...items)

      console.log(`[ghl] conversations page ${page + 1}: ${items.length} items, total so far: ${all.length}`)

      // Stop when oldest item's lastMessageDate is before our range
      const oldest = items[items.length - 1] as Record<string, unknown> | undefined
      const oldestMsgDate = String(oldest?.lastMessageDate || oldest?.dateUpdated || oldest?.dateAdded || '')
      if (oldestMsgDate && new Date(oldestMsgDate).getTime() < new Date(dateFrom + 'T00:00:00Z').getTime()) break
      if (items.length < 100) break

      // Cursor = lastMessageDate of last item (matches sortBy: last_message_date)
      startAfterDate = oldestMsgDate || ''
      if (!startAfterDate) break
    }
  } catch (e) {
    console.log(`[ghl] conversations/search failed: ${String(e)}`)
    return []
  }

  const fromMs = new Date(dateFrom + 'T00:00:00Z').getTime()
  const toMs   = new Date(dateTo   + 'T23:59:59Z').getTime()

  const typeCounts: Record<string, number> = {}
  const byDate = new Map<string, { totalCalls: number; missedCalls: number; emailsSent: number; smsSent: number }>()
  for (const conv of all) {
    // Use lastMessageDate for date attribution — conversations can be old threads with recent activity.
    // dateAdded is when the thread was created (often years ago), not when the call/SMS happened.
    const activityDate = String(conv.lastMessageDate || conv.dateUpdated || conv.dateAdded || conv.createdAt || '')
    if (!activityDate) continue
    const ts = new Date(activityDate).getTime()
    if (ts < fromMs || ts > toMs) continue

    const date = activityDate.split('T')[0]
    if (!date) continue
    const ex  = byDate.get(date) ?? { totalCalls: 0, missedCalls: 0, emailsSent: 0, smsSent: 0 }
    const typ = String(conv.type || '').toUpperCase()

    typeCounts[typ] = (typeCounts[typ] ?? 0) + 1

    if (CALL_TYPES.has(typ)) {
      ex.totalCalls++
      const unread = conv.unreadCount as number ?? 0
      if (unread > 0) ex.missedCalls++
    } else if (EMAIL_TYPES.has(typ)) {
      ex.emailsSent++
    } else if (SMS_TYPES.has(typ)) {
      ex.smsSent++
    }
    byDate.set(date, ex)
  }

  console.log(`[ghl] conversations in range (${dateFrom}–${dateTo}): type breakdown:`, typeCounts)

  return Array.from(byDate.entries()).map(([date, v]) => ({ date, ...v }))
}

async function fetchConversationMessages(
  apiKey: string,
  locationId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ date: string; totalCalls: number; missedCalls: number; emailsSent: number; smsSent: number }[]> {
  // Attempts to get individual message records (not just conversation threads) for accurate daily counts.
  // Each call in a single phone conversation is a separate message — this fixes undercounting.
  const all: Record<string, unknown>[] = []
  let lastMessageId: string | undefined

  try {
    for (let page = 0; page < 200; page++) {
      const p: Record<string, string> = {
        locationId,
        limit: '100',
        sort:  'desc',
      }
      if (lastMessageId) p.lastMessageId = lastMessageId

      const data  = await ghlGet('/conversations/messages/search', apiKey, p, 4, '2021-04-15')
      const items = (data.messages as Record<string, unknown>[]) ?? []
      all.push(...items)

      if (items.length === 0) break

      const oldest = items[items.length - 1] as Record<string, unknown> | undefined
      const oldestDate = String(oldest?.dateAdded || oldest?.createdAt || '')
      if (oldestDate && new Date(oldestDate).getTime() < new Date(dateFrom + 'T00:00:00Z').getTime()) break
      if (items.length < 100) break

      lastMessageId = String(oldest?.id || '')
      if (!lastMessageId) break
    }
  } catch {
    // This endpoint may not be available — caller falls back to conversation-level counting
    return []
  }

  const fromMs = new Date(dateFrom + 'T00:00:00Z').getTime()
  const toMs   = new Date(dateTo   + 'T23:59:59Z').getTime()

  const byDate = new Map<string, { totalCalls: number; missedCalls: number; emailsSent: number; smsSent: number }>()
  for (const msg of all) {
    const created = String(msg.dateAdded || msg.createdAt || '')
    if (!created) continue
    const ts = new Date(created).getTime()
    if (ts < fromMs || ts > toMs) continue

    const date = created.split('T')[0]
    if (!date) continue
    const ex  = byDate.get(date) ?? { totalCalls: 0, missedCalls: 0, emailsSent: 0, smsSent: 0 }
    const typ = String(msg.messageType || msg.type || '').toUpperCase()

    if (CALL_TYPES.has(typ)) {
      ex.totalCalls++
      if (String(msg.callStatus || msg.status || '') === 'missed') ex.missedCalls++
    } else if (EMAIL_TYPES.has(typ)) {
      ex.emailsSent++
    } else if (SMS_TYPES.has(typ)) {
      ex.smsSent++
    }
    byDate.set(date, ex)
  }

  console.log(`[ghl] messages endpoint: ${all.length} messages fetched`)
  return Array.from(byDate.entries()).map(([date, v]) => ({ date, ...v }))
}

async function fetchFormSubmissions(
  apiKey: string,
  locationId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ date: string; count: number }[]> {
  // List all forms first (offset-based, max 50 per page)
  let forms: Record<string, unknown>[] = []
  try {
    let skip = 0
    for (;;) {
      const data = await ghlGet('/forms/', apiKey, { locationId, limit: '50', skip: String(skip) })
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

    // Submissions use page-based pagination and startAt/endAt (YYYY-MM-DD)
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
          const created = String(sub.createdAt || '')
          const date = created.split('T')[0]
          if (!date) continue
          byDate.set(date, (byDate.get(date) ?? 0) + 1)
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
      // Run all fetches sequentially to avoid burst rate limits
      const contactData = await fetchContacts(apiKey, locationId, dateFrom, dateTo)
      console.log(`[ghl] contacts in range: ${contactData.reduce((s, d) => s + d.count, 0)} across ${contactData.length} days`)

      // Try message-level endpoint first (accurate per-call/SMS/email counts).
      // If it returns empty or fails, fall back to conversation-thread counting.
      let convData = await fetchConversationMessages(apiKey, locationId, dateFrom, dateTo)
      if (convData.length === 0) {
        console.log('[ghl] messages endpoint returned nothing — falling back to conversation threads')
        convData = await fetchConversations(apiKey, locationId, dateFrom, dateTo)
      }

      const formData = await fetchFormSubmissions(apiKey, locationId, dateFrom, dateTo)
      console.log(`[ghl] forms in range: ${formData.reduce((s, d) => s + d.count, 0)} across ${formData.length} days`)

      const allDates   = dateRange(dateFrom, dateTo)
      const contactMap = new Map(contactData.map(d => [d.date, d]))
      const convMap    = new Map(convData.map(d => [d.date, d]))
      const formMap    = new Map(formData.map(d => [d.date, d]))

      const rows: GhlRawRow[] = allDates.map(date => {
        const c = contactMap.get(date)
        const v = convMap.get(date)
        const f = formMap.get(date)
        return {
          date,
          contacts_created: c?.count ?? 0,
          total_calls:      v?.totalCalls ?? 0,
          missed_calls:     v?.missedCalls ?? 0,
          forms_submitted:  f?.count ?? 0,
          reviews_sent:     0,
          reviews_received: 0,
          spam_leads:       c?.spam ?? 0,
          emails_sent:      v?.emailsSent ?? 0,
          sms_sent:         v?.smsSent ?? 0,
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function dateRange(from: string, to: string): string[] {
  const dates: string[] = []
  const d = new Date(from)
  const end = new Date(to)
  while (d <= end) {
    dates.push(d.toISOString().split('T')[0])
    d.setDate(d.getDate() + 1)
  }
  return dates
}
