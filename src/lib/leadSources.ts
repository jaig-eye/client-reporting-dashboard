// ─────────────────────────────────────────────────────────────────────────────
// Lead sources from GoHighLevel's own contact attribution
//
// GHL records how each contact first reached the business: the landing page, UTM tags,
// ad click IDs and its own "session source" label. This sorts each contact into one
// channel, and each channel into paid, organic or untracked, so a dashboard can say how
// many leads the ads brought in and how many arrived on their own.
//
// Only counts per channel leave this module. No names, emails, URLs or click IDs are
// stored, so nothing personal lands in ghl_metrics.
// ─────────────────────────────────────────────────────────────────────────────

export type LeadSourceGroup = 'paid' | 'organic' | 'untracked'

export type LeadSourceKey =
  | 'google_ads' | 'meta_ads' | 'other_paid'
  | 'organic_search' | 'google_business' | 'social' | 'referral' | 'direct'
  | 'other' | 'untracked'

/**
 * Which of GHL's two attributions to sort by.
 *   first: how the person originally found the business (GHL's "First Attribution")
 *   last:  their most recent visit before they became a lead (GHL's "Latest Attribution")
 * A contact with one visit has the same answer for both.
 */
export type Touch = 'first' | 'last'

/** Daily counts per channel, stored at ghl_metrics.raw_data.lead_sources (first touch)
 *  and raw_data.lead_sources_last (last touch). */
export type LeadSourceCounts = Partial<Record<LeadSourceKey, number>>

export const LEAD_SOURCES: { key: LeadSourceKey; label: string; group: LeadSourceGroup }[] = [
  { key: 'google_ads',      label: 'Google Ads',                 group: 'paid' },
  { key: 'meta_ads',        label: 'Facebook & Instagram ads',   group: 'paid' },
  { key: 'other_paid',      label: 'Other ads',                  group: 'paid' },
  { key: 'organic_search',  label: 'Search engines',             group: 'organic' },
  { key: 'google_business', label: 'Google Business Profile',    group: 'organic' },
  { key: 'social',          label: 'Social media',               group: 'organic' },
  { key: 'referral',        label: 'Other websites',             group: 'organic' },
  { key: 'direct',          label: 'Came straight to your site', group: 'organic' },
  // A source GHL recorded that none of the rules recognise. It could be an ad or not, so it is not
  // counted as organic: it sits with "no source" until a rule is added for it.
  { key: 'other',           label: 'Other sources',              group: 'untracked' },
  { key: 'untracked',       label: 'No source recorded',         group: 'untracked' },
]

const KEYS = new Set<string>(LEAD_SOURCES.map(s => s.key))

type Attr = Record<string, unknown>

const str = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '')

function isObj(v: unknown): v is Attr {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length > 0
}

/** Reads a field under any of the spellings GHL uses across endpoints. */
function pick(a: Attr, ...names: string[]): string {
  for (const n of names) {
    const v = str(a[n])
    if (v) return v
  }
  return ''
}

/**
 * The attribution to classify by. /contacts/search returns an `attributions` array flagged
 * isFirst/isLast; /contacts/{id} returns attributionSource (first) and lastAttributionSource
 * (latest). When only one is filled, the person had one recorded visit, so it answers both.
 */
export function contactAttribution(contact: Record<string, unknown>, touch: Touch = 'first'): Attr | null {
  const list = Array.isArray(contact.attributions) ? (contact.attributions as unknown[]).filter(isObj) : []
  if (list.length > 0) {
    const first = list.find(a => a.isFirst === true)
    const last  = list.find(a => a.isLast === true)
    return touch === 'first'
      ? first ?? last ?? list[0]
      : last ?? first ?? list[list.length - 1]
  }
  const first = isObj(contact.attributionSource)     ? contact.attributionSource     : null
  const last  = isObj(contact.lastAttributionSource) ? contact.lastAttributionSource : null
  return touch === 'first' ? first ?? last : last ?? first
}

const PAID_MEDIUM   = /^(cpc|ppc|paid|paid[_ -]?(search|social|media)|cpm|cpv|display|ads?|sem|retargeting|remarketing)$/
const GOOGLE_SRC    = /(^|[^a-z])(google|adwords|youtube)([^a-z]|$)/
const META_SRC      = /(facebook|instagram|meta|^fb$|^ig$|messenger)/
const GBP_SRC       = /^(gmb|gbp|google[_ -]?(my[_ -]?business|business([_ -]?profile)?|maps)|maps)$/
const SEARCH_REF    = /(^|\.)(google|bing|yahoo|duckduckgo|ecosia|yandex|baidu|search\.brave)\./
const SOCIAL_REF    = /(facebook|instagram|fb\.com|(^|\.)t\.co$|twitter|x\.com|linkedin|lnkd\.in|tiktok|pinterest|youtube|reddit|nextdoor)/
const INTERNAL_SESS = /^(crm ui|crm|third party|mobile app|api|import|zapier|workflow)$/

function hostOf(url: string): string {
  if (!url) return ''
  try { return new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '') } catch { return '' }
}

/** One contact's channel. Pure, so it can be tested without GHL. */
export function classifyContact(contact: Record<string, unknown>, touch: Touch = 'first'): LeadSourceKey {
  const a = contactAttribution(contact, touch)
  if (!a) return 'untracked'

  const session   = pick(a, 'sessionSource', 'utmSessionSource')
  const utmSrc    = pick(a, 'utmSource', 'utm_source')
  const medium    = pick(a, 'utmMedium', 'utm_medium')
  const ghlMedium = pick(a, 'medium')   // GHL's own: form, survey, calendar, chat_widget, call, facebook_lead…
  const referrer  = hostOf(pick(a, 'referrer', 'referer'))
  const gclid     = pick(a, 'gclid', 'gbraid', 'wbraid', 'dclid')
  const fbclid    = pick(a, 'fbclid', 'fbc')
  const otherClk  = pick(a, 'msclkid', 'msclikid', 'ttclid', 'li_fat_id', 'twclid')
  const adIds     = pick(a, 'adId', 'adGroupId', 'campaignId', 'adSource')
  const paidMed   = PAID_MEDIUM.test(medium)

  // ── Paid ────────────────────────────────────────────────────────────────
  // A Google click ID only exists when someone clicked a Google ad.
  if (gclid) return 'google_ads'
  if (paidMed && GOOGLE_SRC.test(utmSrc)) return 'google_ads'
  if (/^facebook[_ ]?(lead|form)/.test(ghlMedium)) return 'meta_ads'
  // fbclid is added to organic Facebook link clicks too, so on its own it means social, not ads.
  if (fbclid && (paidMed || adIds)) return 'meta_ads'
  if (paidMed && META_SRC.test(utmSrc)) return 'meta_ads'
  if (otherClk) return 'other_paid'
  if (session === 'paid search') return !utmSrc || GOOGLE_SRC.test(utmSrc) ? 'google_ads' : 'other_paid'
  if (session === 'paid social') return !utmSrc || META_SRC.test(utmSrc) ? 'meta_ads' : 'other_paid'
  if (paidMed) return 'other_paid'

  // ── Organic ─────────────────────────────────────────────────────────────
  if (GBP_SRC.test(utmSrc) || /^(business|maps)\.google\./.test(referrer)) return 'google_business'
  if (session === 'organic search' || SEARCH_REF.test(`.${referrer}`)) return 'organic_search'
  if (fbclid || session === 'social media' || session === 'social' || SOCIAL_REF.test(referrer) || META_SRC.test(utmSrc)) return 'social'
  if (session === 'referral' || referrer) return 'referral'
  if (session === 'direct traffic' || session === 'direct') return 'direct'

  // Added inside the CRM, imported, or pushed in by another tool: nothing says how they found you.
  if (INTERNAL_SESS.test(session)) return 'untracked'
  if (session || utmSrc) return 'other'
  return 'untracked'
}

export function groupOf(key: LeadSourceKey): LeadSourceGroup {
  return LEAD_SOURCES.find(s => s.key === key)?.group ?? 'untracked'
}

/** Adds stored daily counts into a running total, ignoring anything that is not a known channel. */
export function addLeadSources(into: LeadSourceCounts, from: unknown): LeadSourceCounts {
  if (!isObj(from)) return into
  for (const [k, v] of Object.entries(from)) {
    const n = Number(v)
    if (!KEYS.has(k) || !Number.isFinite(n) || n <= 0) continue
    into[k as LeadSourceKey] = (into[k as LeadSourceKey] ?? 0) + n
  }
  return into
}

export interface LeadSourceSummary {
  total:     number
  paid:      number
  organic:   number
  untracked: number
  channels:  { key: LeadSourceKey; label: string; group: LeadSourceGroup; count: number }[]
}

export function summariseLeadSources(counts: LeadSourceCounts): LeadSourceSummary {
  const channels = LEAD_SOURCES
    .map(s => ({ ...s, count: counts[s.key] ?? 0 }))
    .filter(c => c.count > 0)
    .sort((a, b) => b.count - a.count)
  const sum = (g: LeadSourceGroup) => channels.filter(c => c.group === g).reduce((s, c) => s + c.count, 0)
  const paid = sum('paid'), organic = sum('organic'), untracked = sum('untracked')
  return { total: paid + organic + untracked, paid, organic, untracked, channels }
}
