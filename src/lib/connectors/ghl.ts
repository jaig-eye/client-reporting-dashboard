// ─────────────────────────────────────────────────────────────────────────────
// GoHighLevel CRM Connector
//
// Implements ConnectorAdapter for the GoHighLevel API v2.
// Auth: Private integration key (API key) + Location ID.
//
// Auth object shape:
//   { api_key: string }
//
// Config object shape:
//   { location_id: string }
//
// External ID: the GHL location ID
//
// Fetches: contacts, calls, form submissions, reviews per day
// ─────────────────────────────────────────────────────────────────────────────

import type { ConnectorAdapter, SyncResult, DiscoveredAccount } from './types'

const BASE_URL = 'https://services.leadconnectorhq.com'

/** Raw GHL metric row — one per day. */
export interface GhlRawRow {
  date: string
  contacts_created: number
  total_calls: number
  missed_calls: number
  forms_submitted: number
  reviews_sent: number
  reviews_received: number
  spam_leads: number
  emails_sent: number
  sms_sent: number
  raw_data: Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────────────────

async function ghlGet(
  path: string,
  apiKey: string,
  params: Record<string, string> = {}
): Promise<Record<string, unknown>> {
  const url = new URL(`${BASE_URL}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url.toString(), {
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Version:        '2021-07-28',
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GHL API error ${res.status}: ${text}`)
  }
  return res.json() as Promise<Record<string, unknown>>
}

/** Paginate through all results from a GHL list endpoint. */
async function ghlPaginate<T>(
  path: string,
  apiKey: string,
  params: Record<string, string>,
  dataKey: string
): Promise<T[]> {
  const all: T[] = []
  let startAfterId: string | undefined

  for (let page = 0; page < 50; page++) {
    const p = { ...params }
    if (startAfterId) p.startAfterId = startAfterId

    const data = await ghlGet(path, apiKey, p)
    const items = (data[dataKey] as T[]) ?? []
    all.push(...items)

    // GHL pagination: if fewer items than limit, we're done
    if (items.length < 100) break
    const lastItem = items[items.length - 1] as Record<string, unknown>
    startAfterId = lastItem?.id as string
    if (!startAfterId) break
  }

  return all
}

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers
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

function startOfDay(dateStr: string): string {
  return `${dateStr}T00:00:00Z`
}

function endOfDay(dateStr: string): string {
  return `${dateStr}T23:59:59Z`
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
  const contacts = await ghlPaginate<Record<string, unknown>>(
    '/contacts/',
    apiKey,
    {
      locationId,
      limit: '100',
      startDate: startOfDay(dateFrom),
      endDate: endOfDay(dateTo),
    },
    'contacts'
  )

  // Group by date
  const byDate = new Map<string, { count: number; spam: number }>()
  for (const c of contacts) {
    const created = String(c.dateAdded || c.createdAt || '')
    const date = created.split('T')[0]
    if (!date) continue
    const ex = byDate.get(date) ?? { count: 0, spam: 0 }
    ex.count++
    // Check for spam tags
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
  // GHL conversations endpoint — get all conversations in date range
  let conversations: Record<string, unknown>[]
  try {
    conversations = await ghlPaginate<Record<string, unknown>>(
      '/conversations/search',
      apiKey,
      {
        locationId,
        limit: '100',
        startDate: startOfDay(dateFrom),
        endDate: endOfDay(dateTo),
      },
      'conversations'
    )
  } catch {
    // Fallback: conversations/search may not exist on all plans
    conversations = []
  }

  const byDate = new Map<string, { totalCalls: number; missedCalls: number; emailsSent: number; smsSent: number }>()
  for (const conv of conversations) {
    const created = String(conv.dateAdded || conv.createdAt || '')
    const date = created.split('T')[0]
    if (!date) continue
    const ex = byDate.get(date) ?? { totalCalls: 0, missedCalls: 0, emailsSent: 0, smsSent: 0 }
    const type = String(conv.type || '').toLowerCase()
    if (type === 'call' || type === 'phone') {
      ex.totalCalls++
      const status = String(conv.status || conv.callStatus || '').toLowerCase()
      if (status === 'missed' || status === 'no-answer' || status === 'voicemail') ex.missedCalls++
    } else if (type === 'email') {
      ex.emailsSent++
    } else if (type === 'sms') {
      ex.smsSent++
    }
    byDate.set(date, ex)
  }

  return Array.from(byDate.entries()).map(([date, v]) => ({ date, ...v }))
}

async function fetchFormSubmissions(
  apiKey: string,
  locationId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ date: string; count: number }[]> {
  // Get all forms first, then submissions for each
  let forms: Record<string, unknown>[] = []
  try {
    const data = await ghlGet('/forms/', apiKey, { locationId, limit: '100' })
    forms = (data.forms as Record<string, unknown>[]) ?? []
  } catch {
    return []
  }

  const byDate = new Map<string, number>()

  for (const form of forms) {
    const formId = String(form.id || '')
    if (!formId) continue

    try {
      const data = await ghlGet(`/forms/submissions`, apiKey, {
        locationId,
        formId,
        limit: '100',
        startDate: startOfDay(dateFrom),
        endDate: endOfDay(dateTo),
      })
      const subs = (data.submissions as Record<string, unknown>[]) ?? []
      for (const sub of subs) {
        const created = String(sub.createdAt || '')
        const date = created.split('T')[0]
        if (!date) continue
        byDate.set(date, (byDate.get(date) ?? 0) + 1)
      }
    } catch {
      // Individual form submission fetch failure — skip
    }
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
      // Fetch all data sources in parallel
      const [contactData, convData, formData] = await Promise.all([
        fetchContacts(apiKey, locationId, dateFrom, dateTo),
        fetchConversations(apiKey, locationId, dateFrom, dateTo),
        fetchFormSubmissions(apiKey, locationId, dateFrom, dateTo),
      ])

      // Merge into daily buckets
      const allDates = dateRange(dateFrom, dateTo)
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
          reviews_sent:     0,  // TODO: add review endpoint when available
          reviews_received: 0,
          spam_leads:       c?.spam ?? 0,
          emails_sent:      v?.emailsSent ?? 0,
          sms_sent:         v?.smsSent ?? 0,
          raw_data:         {},
        }
      })

      // Return as SyncResult — rows won't match RawMetricRow union,
      // so the sync engine handles GHL separately
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
      const loc = (data.location ?? data) as Record<string, unknown>
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
