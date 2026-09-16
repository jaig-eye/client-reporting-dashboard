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
import {
  attributionLabel, classifyContact, classifyLead, contactAttribution, groupOf, trackingNumberSource,
  type LeadSourceCounts, type LeadSourceKey,
} from '../leadSources'

const BASE_URL = 'https://services.leadconnectorhq.com'

// Voice call message types — these appear in lastMessageType when the most recent
// activity on a thread was an actual voice call. TYPE_PHONE is the conversation
// channel type but also covers SMS threads — checking lastMessageType ensures we
// only count real voice calls, not text messages on a phone number thread.
const VOICE_CALL_MSG_TYPES = new Set([
  'TYPE_CALL', 'TYPE_MISSED_CALL', 'TYPE_IVR_CALL', 'TYPE_CUSTOM_CALL', 'TYPE_CAMPAIGN_CALL',
])
// Conversation channel for a phone thread. Calls and texts both live here, so it picks the
// threads worth opening for call detail, not the calls themselves.
const PHONE_CONV_TYPE = 'TYPE_PHONE'

// Opening a conversation costs a request each, so only the callers we cannot already place are
// worth opening, and never more than this many in one sync.
const MAX_CALL_LOOKUPS        = 400
const CALL_LOOKUP_CONCURRENCY = 6

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
        // A date field takes one 'range' filter with gte/lte inside it. Passing gte as the operator
        // is refused ("Invalid Operator (gte) passed for field date_added"), and the sync then falls
        // back to paging the whole account — 10,000 contacts for a busy one.
        {
          field:    'dateAdded',
          operator: 'range',
          value:    {
            gte: new Date(dateFrom + 'T00:00:00Z').toISOString(),
            lte: new Date(dateTo   + 'T23:59:59Z').toISOString(),
          },
        },
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

/** Last ten digits, so +1 (321) 555-0100 and 3215550100 are the same number. */
function numberKey(raw: unknown): string {
  const digits = String(raw ?? '').replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : ''
}

export interface TrackingNumber {
  /** The name the number carries in the phone system — what says which channel it stands for. */
  name:   string
  inPool: boolean
}

/**
 * Every number this location owns, by last ten digits, with the name it carries and whether it
 * belongs to a pool.
 *
 * This doubles as the privacy guard for call detail: a number is only ever read off a message when
 * it is one of these, so a caller's own number can never be picked up. When the token has no phone
 * system scope this comes back empty and the call lookup is skipped entirely.
 */
async function fetchTrackingNumbers(
  apiKey: string,
  locationId: string,
  outcome?: { refused: boolean },
): Promise<Map<string, TrackingNumber>> {
  const numbers = new Map<string, TrackingNumber>()

  // Pool numbers first, so a number listed in both is remembered as pooled.
  try {
    const data  = await ghlGet('/phone-system/number-pools', apiKey, { locationId }, 2, 'v3')
    const inner = data.data as Record<string, unknown> | undefined
    const pools = ((inner?.numberPools ?? inner?.pools ?? data.numberPools ?? data.pools) ?? []) as Record<string, unknown>[]
    for (const pool of pools) {
      const poolName = String(pool.name ?? pool.friendlyName ?? 'Website pool')
      for (const n of (pool.numbers ?? pool.phoneNumbers ?? []) as unknown[]) {
        const raw = typeof n === 'string' ? n : (n as Record<string, unknown>)?.phoneNumber
        const key = numberKey(raw)
        if (key) numbers.set(key, { name: poolName, inPool: true })
      }
    }
    console.log(`[ghl] number pools: ${pools.length}, pooled numbers ${numbers.size}`)
  } catch (e) {
    if (outcome) outcome.refused = true
    console.log(`[ghl] number pools unavailable (needs the phone system scope): ${String(e).slice(0, 200)}`)
  }

  try {
    const data  = await ghlGet(
      `/phone-system/numbers/location/${locationId}`, apiKey,
      { pageSize: '1000', page: '0', skipNumberPool: 'false' }, 2, 'v3')
    const inner = data.data as Record<string, unknown> | undefined
    const list  = ((inner?.numbers ?? data.numbers) ?? []) as Record<string, unknown>[]
    for (const n of list) {
      const key = numberKey(n.phoneNumber ?? n.number)
      if (!key || numbers.has(key)) continue
      numbers.set(key, { name: String(n.friendlyName ?? n.name ?? ''), inPool: false })
    }
  } catch (e) {
    if (outcome) outcome.refused = true
    console.log(`[ghl] number list unavailable (needs the phone system scope): ${String(e).slice(0, 200)}`)
  }

  if (numbers.size > 0) {
    // Names only — never the numbers themselves.
    const named = Array.from(numbers.values()).map(v => `${v.name || '(unnamed)'}${v.inPool ? ' [pool]' : ''}`)
    console.log(`[ghl] tracking numbers: ${numbers.size} — ${named.join(', ')}`)
  }
  return numbers
}

export interface DialledCall {
  date:      string
  contactId: string
  /** Last ten digits of the number the caller dialled. Always one of the location's own. */
  dialled:   string
}

/**
 * Which of the business's numbers each caller dialled.
 *
 * Only inbound call messages are read, and only `to` — the business's own end. The caller's number
 * sits in `from` and is never touched, and anything that is not already a known tracking number is
 * dropped, so a consumer's number cannot reach this list even if GHL fills a field unexpectedly.
 */
async function fetchDialledNumbers(
  apiKey: string,
  conversations: { id: string; contactId: string }[],
  ownNumbers: Map<string, TrackingNumber>,
  dateFrom: string,
  dateTo: string,
): Promise<DialledCall[]> {
  if (ownNumbers.size === 0 || conversations.length === 0) return []

  const fromMs = new Date(dateFrom + 'T00:00:00Z').getTime()
  const toMs   = new Date(dateTo   + 'T23:59:59Z').getTime()
  const wanted = conversations.slice(0, MAX_CALL_LOOKUPS)
  if (conversations.length > wanted.length) {
    console.log(`[ghl] call detail: ${conversations.length} threads to open, capped at ${MAX_CALL_LOOKUPS}`)
  }

  const calls: DialledCall[] = []
  let failed = 0
  for (let i = 0; i < wanted.length; i += CALL_LOOKUP_CONCURRENCY) {
    await Promise.allSettled(wanted.slice(i, i + CALL_LOOKUP_CONCURRENCY).map(async (conv) => {
      let data: Record<string, unknown>
      try {
        data = await ghlGet(`/conversations/${conv.id}/messages`, apiKey, { limit: '100' }, 2, '2021-04-15')
      } catch { failed++; return }
      const envelope = data.messages as unknown
      const list = (Array.isArray(envelope)
        ? envelope
        : (envelope as Record<string, unknown> | undefined)?.messages) as Record<string, unknown>[] | undefined
      for (const msg of list ?? []) {
        if (String(msg.direction ?? '').toLowerCase() !== 'inbound') continue
        if (!VOICE_CALL_MSG_TYPES.has(String(msg.messageType ?? '').toUpperCase())) continue
        const parsed = parseGhlDate(msg.dateAdded ?? msg.dateUpdated)
        if (!parsed || parsed.ts < fromMs || parsed.ts > toMs) continue
        // `to` on an inbound call is the business's end. Keep it only if we already know it.
        const dialled = numberKey(msg.to)
        if (!dialled || !ownNumbers.has(dialled)) continue
        calls.push({ date: parsed.date, contactId: conv.contactId, dialled })
      }
    }))
  }
  if (failed > 0) console.log(`[ghl] call detail: ${failed} of ${wanted.length} threads could not be opened`)
  console.log(`[ghl] call detail: ${calls.length} inbound calls matched to one of your numbers`)
  return calls
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics fetching
// ─────────────────────────────────────────────────────────────────────────────

export interface ContactDay {
  date:    string
  count:   number
  spam:    number
  sources: LeadSourceCounts
  /** The leads behind those counts, so a call to a tracking number can re-place one. Held in
   *  memory for the length of the sync only — contact ids are never written anywhere. */
  leads:   { id: string; key: LeadSourceKey }[]
}

async function fetchContacts(
  apiKey: string,
  locationId: string,
  dateFrom: string,
  dateTo: string
): Promise<ContactDay[]> {
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

  const byDate = new Map<string, { count: number; spam: number; sources: LeadSourceCounts; leads: { id: string; key: LeadSourceKey }[] }>()
  // Which attribution fields GHL actually sent, by name only, so the logs show whether the
  // classifier has something to work with without ever printing a contact's details.
  const attrKeys = new Map<string, number>()
  let withAttr = 0
  // The labels GHL uses, counted per field, so contacts in "other" can be given a rule.
  // Lower-cased and capped, and anything that looks like an email or URL is skipped.
  const LABEL_FIELDS = ['sessionSource', 'utmSessionSource', 'medium', 'utmSource', 'utmMedium'] as const
  const attrValues  = new Map<string, Map<string, number>>()
  const sourceTally = new Map<string, number>()
  let adFromLatestVisit = 0
  let inRange = 0
  const unsortedLabels = new Map<string, number>()
  // GHL's own source on the contact, counted by value. It names how the contact got in — a form, an
  // import, an inbound call — for the ones attribution says nothing about.
  const sourceValues = new Map<string, number>()
  for (const c of contacts) {
    const parsed = parseGhlDate(c.dateAdded ?? c.createdAt)
    if (!parsed || parsed.ts < fromMs || parsed.ts > toMs) continue
    if (c.archived === true || c.deleted === true) continue
    inRange++
    const ex   = byDate.get(parsed.date) ?? { count: 0, spam: 0, sources: {}, leads: [] }
    ex.count++
    const tags = (c.tags as string[]) ?? []
    if (tags.some(t => t.toLowerCase().includes('spam'))) {
      ex.spam++
    } else {
      // Spam stays out of the source counts, so the channels add up to the lead count.
      // One channel per lead: an ad on either of GHL's two attributions wins, otherwise the first visit.
      const key = classifyLead(c)
      if (groupOf(key) === 'paid' && groupOf(classifyContact(c, 'first')) !== 'paid') adFromLatestVisit++
      if (groupOf(key) === 'untracked') {
        const label = `${key}: first ${attributionLabel(c, 'first')} | latest ${attributionLabel(c, 'last')}`
        unsortedLabels.set(label, (unsortedLabels.get(label) ?? 0) + 1)
        const src = typeof c.source === 'string' ? c.source.trim().toLowerCase().slice(0, 60) : '(none)'
        if (!src.includes('@')) sourceValues.set(src, (sourceValues.get(src) ?? 0) + 1)
      }
      ex.sources[key] = (ex.sources[key] ?? 0) + 1
      const contactId = String(c.id ?? c.contactId ?? '')
      if (contactId) ex.leads.push({ id: contactId, key })
      sourceTally.set(key, (sourceTally.get(key) ?? 0) + 1)
      const attrs = [contactAttribution(c, 'first'), contactAttribution(c, 'last')]
        .filter((a, i, all): a is Record<string, unknown> => !!a && all.indexOf(a) === i)
      if (attrs.length > 0) withAttr++
      for (const attr of attrs) {
        for (const k of Object.keys(attr)) attrKeys.set(k, (attrKeys.get(k) ?? 0) + 1)
        for (const f of LABEL_FIELDS) {
          const v = typeof attr[f] === 'string' ? (attr[f] as string).trim().toLowerCase().slice(0, 60) : ''
          if (!v || v.includes('@') || /^https?:/.test(v)) continue
          const counts = attrValues.get(f) ?? new Map<string, number>()
          counts.set(v, (counts.get(v) ?? 0) + 1)
          attrValues.set(f, counts)
        }
      }
    }
    byDate.set(parsed.date, ex)
  }
  if (contacts.length > 0) {
    const fields = Array.from(attrKeys, ([k, n]) => `${k}:${n}`).join(',')
    console.log(`[ghl] attribution: ${withAttr}/${inRange} contacts in range have it (${contacts.length} fetched); fields ${fields || 'none'}`)
    console.log(`[ghl] lead sources: ${Array.from(sourceTally, ([k, n]) => `${k}:${n}`).join(',') || 'none'}`)
    console.log(`[ghl] counted as ad leads because of their latest visit: ${adFromLatestVisit}`)
    const unsorted = Array.from(unsortedLabels).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([l, n]) => `${n}× ${l}`)
    if (unsorted.length > 0) console.log(`[ghl] leads with no clear source, by label:\n  ${unsorted.join('\n  ')}`)
    const srcVals = Array.from(sourceValues).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([v, n]) => `${v}:${n}`)
    if (srcVals.length > 0) console.log(`[ghl] their contact.source values: ${srcVals.join(', ')}`)
    for (const [field, counts] of Array.from(attrValues)) {
      const top = Array.from(counts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([v, n]) => `${v}:${n}`).join(', ')
      console.log(`[ghl] attribution ${field}: ${top}`)
    }
  }

  return Array.from(byDate.entries()).map(([date, v]) => ({ date, ...v }))
}

export interface ConversationResult {
  daily: {
    date: string; totalCalls: number; incomingCalls: number; outgoingCalls: number
    missedCalls: number; emailsSent: number; smsSent: number
  }[]
  /** In-range phone threads, so call detail can be looked up for the callers who need it. */
  phoneThreads: { id: string; contactId: string; date: string }[]
}

/** One pass of /conversations/search, newest first, back as far as `fromMs`. */
async function pageConversations(
  apiKey: string,
  locationId: string,
  fromMs: number,
  extra: Record<string, string> = {},
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = []
  let startAfterDate: string | undefined

  for (let page = 0; page < 100; page++) {
    const p: Record<string, string> = {
      locationId,
      limit:  '100',
      sortBy: 'last_message_date',
      sort:   'desc',
      ...extra,
    }
    if (startAfterDate) p.startAfterDate = startAfterDate

    const data  = await ghlGet('/conversations/search', apiKey, p, 4, '2021-04-15')
    const items = (data.conversations as Record<string, unknown>[]) ?? []
    all.push(...items)
    if (items.length === 0) break

    const oldest       = items[items.length - 1]
    const oldestParsed = parseGhlDate(oldest.lastMessageDate ?? oldest.dateUpdated ?? oldest.dateAdded)
    if (oldestParsed && oldestParsed.ts < fromMs) break
    if (items.length < 100) break

    const rawCursor = oldest.lastMessageDate ?? oldest.dateUpdated ?? oldest.dateAdded
    startAfterDate  = rawCursor != null ? String(rawCursor) : ''
    if (!startAfterDate) break
  }
  return all
}

async function fetchConversations(
  apiKey: string,
  locationId: string,
  dateFrom: string,
  dateTo: string
): Promise<ConversationResult> {
  const fromMs = new Date(dateFrom + 'T00:00:00Z').getTime()
  let all: Record<string, unknown>[] = []
  // A conversation carries no direction of its own, so the same search is run again filtered to
  // inbound and the ids remembered. Without this every call read as outgoing.
  let inboundIds = new Set<string>()

  try {
    const [everything, inbound] = await Promise.all([
      pageConversations(apiKey, locationId, fromMs),
      pageConversations(apiKey, locationId, fromMs, { lastMessageDirection: 'inbound' })
        .catch(e => { console.log(`[ghl] inbound filter failed: ${String(e).slice(0, 160)}`); return null }),
    ])
    all = everything
    if (inbound === null) inboundIds = new Set<string>()
    else inboundIds = new Set(inbound.map(c => String(c.id ?? '')).filter(Boolean))
    console.log(`[ghl] conversations: ${all.length} fetched, ${inboundIds.size} inbound`)
  } catch (e) {
    console.log(`[ghl] conversations/search failed: ${String(e)}`)
    return { daily: [], phoneThreads: [] }
  }

  const toMs = new Date(dateTo + 'T23:59:59Z').getTime()

  const typeCounts: Record<string, number> = {}
  const allTypeCounts: Record<string, number> = {}
  const byDate = new Map<string, { totalCalls: number; incomingCalls: number; outgoingCalls: number; missedCalls: number; emailsSent: number; smsSent: number }>()
  const phoneThreads: { id: string; contactId: string; date: string }[] = []

  // Deduplicate by conversation ID — cursor pagination keyed on lastMessageDate can
  // return the same conversation on two pages when a message arrives mid-pagination.
  const convSeen = new Set<string>()
  const deduped = all.filter(c => {
    const id = String(c.id || '')
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

    const convId    = String(conv.id || '')
    const contactId = String(conv.contactId || '')
    if (typ === PHONE_CONV_TYPE && convId && contactId) {
      phoneThreads.push({ id: convId, contactId, date: parsed.date })
    }

    // Use lastMessageType to detect actual voice calls — TYPE_PHONE conversation channel
    // also covers SMS threads, so checking conv.type alone over-counts.
    const lastMsgType = String(conv.lastMessageType || '').toUpperCase()
    // Only count as a voice call when lastMessageType explicitly indicates a call.
    // TYPE_PHONE is a channel type (covers SMS threads too) — do not use it here.
    const isVoiceCall = VOICE_CALL_MSG_TYPES.has(lastMsgType)
    if (isVoiceCall) {
      const isInbound = inboundIds.has(convId)
      ex.totalCalls++
      if (isInbound) ex.incomingCalls++
      else           ex.outgoingCalls++
      if (lastMsgType === 'TYPE_MISSED_CALL' || lastMsgType.includes('MISSED')) ex.missedCalls++
    } else if (EMAIL_TYPES.has(typ)) {
      ex.emailsSent++
    } else if (SMS_TYPES.has(typ)) {
      ex.smsSent++
    }
    byDate.set(parsed.date, ex)
  }

  console.log(`[ghl] all conversation types (${all.length} total):`, allTypeCounts)
  console.log(`[ghl] in-range conversation types (${dateFrom}–${dateTo}):`, typeCounts)

  return {
    daily: Array.from(byDate.entries()).map(([date, v]) => ({ date, ...v })),
    phoneThreads,
  }
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
          calendarId:  calId,
          startTime:   String(fromMs),
          endTime:     String(toMs),
          filterType:  'created',
          limit:       '100',
          skip:        String(skip),
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

      // Field names only, from the first page, so the logs say whether the CRM records where a
      // review came from — a request we sent, or the customer finding the listing themselves.
      // Google itself never says, so this is the only place an answer could come from.
      if (page === 1 && reviews.length > 0) {
        console.log(`[ghl] review fields: ${Object.keys(reviews[0]).join(',')}`)
      }

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

/**
 * Re-places the leads we could not source, using the number they dialled.
 *
 * Someone who rings the number on a Business Profile listing never lands on the website, so the
 * CRM has no visit to attribute and the lead reads as "no clear source". The number itself is the
 * record of where they found it. Only leads with nothing better already are touched, and the day's
 * total never moves — one channel gives a lead up, another takes it.
 */
function applyCallSources(
  contactData: ContactDay[],
  calls: DialledCall[],
  numbers: Map<string, TrackingNumber>,
  overrides: Record<string, string>,
): { moved: number; byDate: Map<string, LeadSourceCounts> } {
  // A caller who rang more than once is placed by the first number they used.
  const dialledBy = new Map<string, string>()
  const byDate    = new Map<string, LeadSourceCounts>()
  for (const call of [...calls].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!dialledBy.has(call.contactId)) dialledBy.set(call.contactId, call.dialled)
    const info = numbers.get(call.dialled)
    if (!info) continue
    const key = trackingNumberSource(info.name, info.inPool, overrides[call.dialled])
    if (!key) continue
    const day = byDate.get(call.date) ?? {}
    day[key] = (day[key] ?? 0) + 1
    byDate.set(call.date, day)
  }

  let moved = 0
  for (const day of contactData) {
    for (const lead of day.leads) {
      // Anything already placed by the CRM's own attribution stays as it is.
      if (groupOf(lead.key) !== 'untracked') continue
      const dialled = dialledBy.get(lead.id)
      if (!dialled) continue
      const info = numbers.get(dialled)
      if (!info) continue
      const key = trackingNumberSource(info.name, info.inPool, overrides[dialled])
      if (!key || key === lead.key) continue
      const had = day.sources[lead.key] ?? 0
      if (had <= 1) delete day.sources[lead.key]
      else          day.sources[lead.key] = had - 1
      day.sources[key] = (day.sources[key] ?? 0) + 1
      lead.key = key
      moved++
    }
  }
  return { moved, byDate }
}

export const ghlConnector: ConnectorAdapter = {
  type: 'ghl',

  async fetchMetrics(
    externalId: string,
    auth: Record<string, unknown>,
    config: Record<string, unknown>,
    dateFrom: string,
    dateTo: string
  ): Promise<SyncResult> {
    const apiKey     = String(auth.api_key || '')
    const locationId = externalId

    if (!apiKey || !locationId) {
      return { rows: [], error: 'Missing GHL API key or location ID' }
    }

    // Set by fetchTrackingNumbers when the phone system refuses us, which is a different problem
    // from a location that simply has no numbers set up.
    const numberOutcome = { refused: false }

    try {
      // All fetches are independent — run in parallel. ghlGet handles 429s with backoff.
      const [
        contactData,
        convResult,
        formsResult,
        allOppResult,
        reviewData,
        trackingNumbers,
      ] = await Promise.all([
        fetchContacts(apiKey, locationId, dateFrom, dateTo),
        fetchConversations(apiKey, locationId, dateFrom, dateTo),
        fetchFormsAndSurveys(apiKey, locationId, dateFrom, dateTo),
        fetchAllOpportunities(apiKey, locationId, dateFrom, dateTo),
        fetchReviews(apiKey, locationId, dateFrom, dateTo),
        // Best-effort: a token without the phone system scope just means no call sources.
        fetchTrackingNumbers(apiKey, locationId, numberOutcome).catch(() => new Map<string, TrackingNumber>()),
      ])
      const convData = convResult.daily

      // ── Place the callers the CRM couldn't ────────────────────────────────
      // Only threads belonging to a lead we have no source for are worth a request, which keeps
      // this to the size of the gap rather than the size of the account.
      const unplaced = new Set<string>()
      for (const day of contactData) {
        for (const lead of day.leads) if (groupOf(lead.key) === 'untracked') unplaced.add(lead.id)
      }
      const worthOpening = convResult.phoneThreads.filter(t => unplaced.has(t.contactId))
      let callSourceDates = new Map<string, LeadSourceCounts>()
      let moved = 0
      let matchedCalls = 0
      if (worthOpening.length > 0 && trackingNumbers.size > 0) {
        const calls = await fetchDialledNumbers(apiKey, worthOpening, trackingNumbers, dateFrom, dateTo)
        matchedCalls = calls.length
        const applied = applyCallSources(
          contactData, calls, trackingNumbers,
          (config.call_sources as Record<string, string>) ?? {},
        )
        moved = applied.moved
        callSourceDates = applied.byDate
        console.log(`[ghl] call sources: ${moved} of ${unplaced.size} unplaced leads named by the number they dialled`)
      } else {
        console.log(`[ghl] call sources: skipped (${unplaced.size} unplaced leads, ${worthOpening.length} phone threads, ${trackingNumbers.size} tracking numbers)`)
      }

      /**
       * Why call attribution did or didn't happen, so it can be answered from the data rather
       * than from a log line. Each reason has a different fix:
       *   no_phone_scope  the token can't read the phone system — add the scope
       *   no_numbers      the phone system is readable but holds no numbers for this location
       *   nothing_to_fix  every lead already has a source; nothing to attribute
       *   no_call_threads the unsourced leads have no phone conversation, so they aren't calls
       *   unnamed_numbers calls matched a number, but no name or pool said what it stands for
       *   ok              leads were placed by the number they dialled
       * Counts and a code only — no numbers, no names, nothing about a caller.
       */
      const callTracking = {
        reason:
          numberOutcome.refused      ? 'no_phone_scope'
          : trackingNumbers.size === 0 ? 'no_numbers'
          : unplaced.size === 0        ? 'nothing_to_fix'
          : worthOpening.length === 0  ? 'no_call_threads'
          : moved === 0                ? 'unnamed_numbers'
          : 'ok',
        numbers:       trackingNumbers.size,
        pooled:        Array.from(trackingNumbers.values()).filter(n => n.inPool).length,
        named:         Array.from(trackingNumbers.values()).filter(n => n.name.trim()).length,
        unplaced_leads: unplaced.size,
        call_threads:  worthOpening.length,
        matched_calls: matchedCalls,
        placed:        moved,
      }
      console.log('[ghl] call tracking:', JSON.stringify(callTracking))
      const { oppData, closedOppData } = allOppResult
      console.log(`[ghl] contacts in range: ${contactData.reduce((s, d) => s + d.count, 0)} across ${contactData.length} days`)
      console.log(`[ghl] reviews: ${reviewData.reduce((s, d) => s + d.received, 0)}`)

      const allDates      = dateRange(dateFrom, dateTo)
      const contactMap    = new Map(contactData.map(d       => [d.date, d]))
      const callSourceMap = callSourceDates
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
            // Inbound calls by the channel the number dialled stands for. Counts only.
            tracking_calls: callSourceMap.get(date) ?? {},
            // Why call attribution did or didn't run this sync. Same on every day of the range.
            call_tracking: callTracking,
            // Always written, even when empty, so a day synced with attribution can be told
            // apart from a day synced before it existed.
            lead_sources:   c?.sources ?? {},
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
