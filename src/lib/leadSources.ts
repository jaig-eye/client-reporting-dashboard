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

export type LeadSourceGroup = 'paid' | 'organic' | 'internal' | 'untracked'

export type LeadSourceKey =
  | 'google_ads' | 'google_ads_call' | 'meta_ads' | 'meta_ads_call' | 'other_paid'
  | 'organic_search' | 'google_business' | 'ai_assistant' | 'social' | 'referral' | 'direct'
  | 'email' | 'call_or_message' | 'website_call' | 'imported' | 'added_manually' | 'other' | 'untracked'

/**
 * Which of GHL's two attributions to read.
 *   first: how the person originally found the business (GHL's "First Attribution")
 *   last:  their most recent visit before they became a lead (GHL's "Latest Attribution")
 * A contact with one recorded visit has the same answer for both.
 */
export type Touch = 'first' | 'last'

/** Daily counts per channel, stored at ghl_metrics.raw_data.lead_sources. Each lead is counted
 *  once, under the channel classifyLead picks. */
export type LeadSourceCounts = Partial<Record<LeadSourceKey, number>>

export const LEAD_SOURCES: { key: LeadSourceKey; label: string; group: LeadSourceGroup }[] = [
  { key: 'google_ads',      label: 'Google Ads',                      group: 'paid' },
  // A phone call, text or chat from someone whose visit came through an ad.
  { key: 'google_ads_call', label: 'Google Ads calls',                group: 'paid' },
  { key: 'meta_ads',        label: 'Facebook & Instagram ads',        group: 'paid' },
  { key: 'meta_ads_call',   label: 'Facebook & Instagram ad calls',   group: 'paid' },
  { key: 'other_paid',      label: 'Other ads',                       group: 'paid' },
  { key: 'organic_search',  label: 'Search engines',                  group: 'organic' },
  { key: 'google_business', label: 'Google Business Profile',         group: 'organic' },
  { key: 'ai_assistant',    label: 'ChatGPT and other AI assistants', group: 'organic' },
  { key: 'social',          label: 'Social media',                    group: 'organic' },
  { key: 'referral',        label: 'Other websites',                  group: 'organic' },
  { key: 'direct',          label: 'Came straight to your site',      group: 'organic' },
  // GHL sends sessionSource 'email marketing' for a click from a campaign it sent. Owned media
  // rather than something they found, but they came on their own, so it sits with organic.
  { key: 'email',           label: 'Email campaigns',                 group: 'organic' },
  // A call, text or chat that reached the CRM without a website visit, so nothing says what
  // prompted it: it could have come from the listing, an ad's call button, or a business card.
  { key: 'call_or_message', label: 'Calls and messages',              group: 'untracked' },
  // They dialled a number the website script swaps in, so they were on the site — but the CRM
  // recorded no visit, so we still can't name the channel. Better than "no source", not organic.
  { key: 'website_call',    label: 'Called a number on your website', group: 'untracked' },
  // Not marketing. These two are the only thing the CRM tells us: it recorded the contact as
  // arriving through a file import, or as created by someone using the CRM. We say that and no more.
  { key: 'imported',        label: 'Imported from a file',            group: 'internal' },
  { key: 'added_manually',  label: 'Created manually',                group: 'internal' },
  // A source GHL recorded that none of the rules recognise. It could be an ad or not, so it is not
  // counted as organic: it sits with "no source" until a rule is added for it.
  { key: 'other',           label: 'Other sources',                   group: 'untracked' },
  { key: 'untracked',       label: 'No source recorded',              group: 'untracked' },
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
 * One of the contact's two attributions. /contacts/search returns an `attributions` array flagged
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

const PAID_MEDIUM   = /^(cpc|ppc|paid|paid[_ -]?(search|social|media|shopping|video|other)|cpm|cpv|display|ads?|sem|retargeting|remarketing|cross[_ -]?network)$/
// utm_source values that only ever name an ad platform.
const GOOGLE_AD_SRC = /^(adwords|google[_ -]?ads?|googleads|gads|google[_ -]?(cpc|ppc))$/
const MS_AD_SRC     = /^(bing|microsoft)[_ -]?ads?$/
// GA4 / GHL session sources that mean the visit was paid for.
const PAID_SESSION  = /^(paid search|paid social|paid shopping|paid video|paid other|display|cross[- ]network)$/
const GOOGLE_SRC    = /(^|[^a-z])(google|adwords|youtube)([^a-z]|$)/
const META_SRC      = /(facebook|instagram|meta|^fb$|^ig$|messenger)/
const META_AD_SRC   = /^(fb|facebook|ig|instagram|meta)[_ -]?ads?$/
const AI_SRC        = /(chatgpt|openai|perplexity|gemini\.google|copilot\.(microsoft|com)|claude\.ai|deepseek|grok\.com|meta\.ai)/
// GHL's medium when a contact arrived by phone, text or chat rather than a web form.
const CONVERSATION_MEDIUM = /^(conversation|call|phone|sms|chat|chat_widget|messaging)$/
const EMAIL_SESSION = /^(email|email marketing|newsletter)$/
const EMAIL_MEDIUM  = /^(email|e-mail|newsletter)$/
const GBP_SRC       = /^(gmb|gbp|google[_ -]?(my[_ -]?business|business([_ -]?profile)?|maps)|maps)$/
const SEARCH_REF    = /(^|\.)(google|bing|yahoo|duckduckgo|ecosia|yandex|baidu|search\.brave)\./
const SOCIAL_REF    = /(facebook|instagram|fb\.com|(^|\.)t\.co$|twitter|x\.com|linkedin|lnkd\.in|tiktok|pinterest|youtube|reddit|nextdoor)/
// Session sources that say nothing about how the person found the business. "other" is GHL's own
// label for a contact with no recorded website session.
const INTERNAL_SESS = /^(crm ui|crm|third party|mobile app|api|import|zapier|workflow|other)$/
// GHL's medium (and its contact source) when the team added the contact rather than marketing.
const IMPORT_MEDIUM = /(csv|bulk)?_?import|^csv|import$/
const MANUAL_MEDIUM = /^(manual|manually|crm ui|crm|added manually)$/

// What GHL writes into contact.source. These are labels the agency chooses when it sets up a
// form, a pool or a listing, so they are matched loosely — "GBP", "Google Business Profile" and
// "gmb" all mean the same thing, and a pool is named for what it is rather than to a standard.
// Deliberately not a bare /pool/: a swimming-pool company names a line "Pool Service", and
// calling that a website visit would be a confident lie. A pool is named for being one.
const SOURCE_NUMBER_POOL = /(number|website|site|tracking|dynamic|swap)[_ -]?pool|pool[_ -]?\d|call[_ -]?tracking/
const SOURCE_GBP         = /\bgbp\b|\bgmb\b|google[_ -]?business|google[_ -]?my[_ -]?business|business[_ -]?profile|\bmaps\b/

// What an agency calls a tracking number in the phone system, by the channel it stands for.
const GBP_NUMBER       = /(\bgbp\b|\bgmb\b|google business|business profile|google my business|\bmaps\b|\blisting\b)/
const GOOGLE_AD_NUMBER = /(google ads?\b|\badwords\b|\bppc\b|paid search|\bsem\b|\blsa\b|local services)/
const META_NUMBER      = /(\bfacebook\b|\binstagram\b|\bmeta\b|\bfb\b|\big\b)/
const ORGANIC_NUMBER   = /(\borganic\b|\bseo\b|\bsearch\b)/

function hostOf(url: string): string {
  if (!url) return ''
  try { return new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '') } catch { return '' }
}

/** The channel one of a contact's attributions points to. Pure, so it can be tested without GHL. */
export function classifyContact(contact: Record<string, unknown>, touch: Touch = 'first'): LeadSourceKey {
  const a = contactAttribution(contact, touch)
  if (!a) return 'untracked'

  const session   = pick(a, 'sessionSource', 'utmSessionSource')
  const utmSrc    = pick(a, 'utmSource', 'utm_source')
  const medium    = pick(a, 'utmMedium', 'utm_medium')
  const ghlMedium = pick(a, 'medium')   // GHL's own: form, survey, calendar, chat_widget, call, facebook_lead…
  const referrer  = hostOf(pick(a, 'referrer', 'referer'))
  // Google's click IDs under every spelling GHL and UTM templates use, plus gad_source, which Google
  // adds to ad clicks even when the gclid is stripped.
  const gclid      = pick(a, 'gclid', 'utmGclid', 'utm_gclid', 'gbraid', 'wbraid', 'dclid', 'gadSource', 'gad_source', 'gadCampaignId', 'gad_campaignid')
  const fbclid     = pick(a, 'fbclid', 'utmFbclid', 'utm_fbclid', 'fbc')
  const msclkid    = pick(a, 'msclkid', 'msclikid')
  const otherClk   = pick(a, 'ttclid', 'li_fat_id', 'twclid')
  // Ad, ad group and campaign IDs only exist on ad clicks. A campaign *name* alone doesn't count:
  // plain links (a Business Profile website link, an email) carry campaign names too.
  const adIds      = pick(a, 'adId', 'utmAdId', 'adGroupId', 'utmAdGroupId', 'campaignId', 'utmCampaignId', 'adSource', 'adName')
  // Match type is filled by Google Ads' own tracking template, so it marks a Google ad click.
  const valueTrack = pick(a, 'utmMatchtype', 'utm_matchtype', 'matchtype')
  const paidMed    = PAID_MEDIUM.test(medium)

  // ── Paid: any tracking that ties the visit to an ad ─────────────────────
  const paid = ((): LeadSourceKey | null => {
    if (gclid || valueTrack || GOOGLE_AD_SRC.test(utmSrc)) return 'google_ads'
    if (/^facebook[_ ]?(lead|form)/.test(ghlMedium) || META_AD_SRC.test(utmSrc)) return 'meta_ads'
    // fbclid is added to organic Facebook link clicks too, so it needs a second sign of an ad.
    if (fbclid && (paidMed || adIds || PAID_SESSION.test(session))) return 'meta_ads'
    if (msclkid || otherClk || MS_AD_SRC.test(utmSrc)) return 'other_paid'
    if (paidMed || adIds || PAID_SESSION.test(session)) {
      if (GOOGLE_SRC.test(utmSrc) || GOOGLE_SRC.test(referrer) || (session === 'paid search' && !utmSrc)) return 'google_ads'
      if (META_SRC.test(utmSrc) || /facebook|instagram/.test(referrer) || (session === 'paid social' && !utmSrc)) return 'meta_ads'
      return 'other_paid'
    }
    return null
  })()
  if (paid) {
    // A call, text or chat from an ad visit keeps the ad and says it was a call.
    if (CONVERSATION_MEDIUM.test(ghlMedium)) {
      if (paid === 'google_ads') return 'google_ads_call'
      if (paid === 'meta_ads')   return 'meta_ads_call'
    }
    return paid
  }

  // ── Organic ─────────────────────────────────────────────────────────────
  if (GBP_SRC.test(utmSrc) || /^(business|maps)\.google\./.test(referrer)) return 'google_business'
  // GA4 tags AI assistant visits with medium "ai-assistant"; GHL may carry that through.
  if (AI_SRC.test(utmSrc) || AI_SRC.test(referrer) || medium === 'ai-assistant' || session === 'ai assistant') return 'ai_assistant'
  if (session === 'organic search' || SEARCH_REF.test(`.${referrer}`)) return 'organic_search'
  if (fbclid || session === 'social media' || session === 'social' || SOCIAL_REF.test(referrer) || META_SRC.test(utmSrc)) return 'social'
  if (session === 'referral' || referrer) return 'referral'
  if (session === 'direct traffic' || session === 'direct') return 'direct'
  if (EMAIL_SESSION.test(session) || EMAIL_MEDIUM.test(medium)) return 'email'

  // Put in the CRM by the team, not by marketing.
  if (IMPORT_MEDIUM.test(ghlMedium)) return 'imported'
  if (MANUAL_MEDIUM.test(ghlMedium)) return 'added_manually'

  // No website session behind it: a call, text or chat, or a contact added some other way.
  if ((!session || INTERNAL_SESS.test(session)) && !utmSrc && CONVERSATION_MEDIUM.test(ghlMedium)) return 'call_or_message'
  if (INTERNAL_SESS.test(session) && !utmSrc) return 'untracked'
  if (session || utmSrc) return 'other'
  return 'untracked'
}

/**
 * GHL's own `source` on the contact — "form", "manual", "import", "api", "inbound call" and so on.
 * It is the only thing many contacts carry, so it answers the ones attribution can't.
 */
export function sourceChannel(contact: Record<string, unknown>): LeadSourceKey | null {
  const source = typeof contact.source === 'string' ? contact.source.trim().toLowerCase() : ''
  if (!source) return null
  if (/import|csv|bulk|migrat/.test(source))                       return 'imported'
  if (/manual|by hand|crm ui|admin/.test(source))                  return 'added_manually'
  if (/facebook lead|instagram lead|lead ad/.test(source))         return 'meta_ads'
  // The specific labels first: a number-pool source reads "website call tracking (number pool)",
  // which contains "call" and would otherwise be swallowed by the generic rule below.
  if (SOURCE_NUMBER_POOL.test(source))                             return 'website_call'
  if (SOURCE_GBP.test(source))                                     return 'google_business'
  if (/call|phone|sms|text|chat|message|whatsapp/.test(source))    return 'call_or_message'
  if (/api|zapier|integration|webhook|workflow|automation|sync/.test(source)) return 'other'
  return null
}

/**
 * The one channel a lead is counted under: the visit they became a lead in.
 *   1. The latest visit decides — that is the one that turned them into a lead.
 *   2. Only when it says nothing does the first visit get a turn.
 *   3. When neither says anything, GHL's own source on the contact answers.
 *
 * Measured on Landworx before choosing: of 571 contacts, 272 carry a channel on both visits and
 * only 18 of those disagree, so this picks between the two about three percent of the time. The
 * worry that a call-converted lead would carry no channel on its latest visit did not hold either
 * — 147 of 185 do.
 */
export function classifyLead(contact: Record<string, unknown>): LeadSourceKey {
  const first = classifyContact(contact, 'first')
  const last  = classifyContact(contact, 'last')
  // Nothing in either attribution: the contact's own source is all there is.
  if (groupOf(first) === 'untracked' && groupOf(last) === 'untracked') {
    const bySource = sourceChannel(contact)
    if (bySource) return bySource
  }
  // The visit they became a lead in decides.
  if (groupOf(last) !== 'untracked')  return last
  // Only when that says nothing does the visit that first brought them here get a turn.
  if (groupOf(first) !== 'untracked') return first
  // Neither points anywhere: keep whichever says the most, an unrecognised label, then a call or
  // message, then nothing at all.
  const unclear: Partial<Record<LeadSourceKey, number>> = { other: 2, call_or_message: 1, untracked: 0 }
  return (unclear[last] ?? 0) > (unclear[first] ?? 0) ? last : first
}

/**
 * The labels on one attribution, for logs: session source, GHL medium, and whether a UTM source or
 * referrer is present. Labels only, never the URL, referrer or any personal detail.
 */
export function attributionLabel(contact: Record<string, unknown>, touch: Touch = 'first'): string {
  const a = contactAttribution(contact, touch)
  if (!a) return 'none'
  const session = pick(a, 'sessionSource', 'utmSessionSource') || '-'
  const medium  = pick(a, 'medium') || '-'
  const utm     = pick(a, 'utmSource', 'utm_source') ? 'utm' : 'no-utm'
  const ref     = pick(a, 'referrer', 'referer') ? 'referrer' : 'no-referrer'
  return `${session} / ${medium} / ${utm} / ${ref}`
}

/**
 * The channel a tracking number stands for.
 *
 * Call tracking gives each place a business advertises its own number: one on the Business
 * Profile, a pool the website script swaps in per visitor. The number dialled is therefore the
 * only record of where a caller found them, and the name the number carries in the phone system
 * says which is which — so an agency renames a number and the reporting follows.
 *
 * `override` is the per-client mapping in the connection config, which always wins.
 * Returns null when the name says nothing and the number is not in a pool: we would be guessing.
 */
export function trackingNumberSource(
  friendlyName: string,
  inPool: boolean,
  override?: string,
): LeadSourceKey | null {
  if (override && KEYS.has(override)) return override as LeadSourceKey
  const name = friendlyName.trim().toLowerCase()
  if (GBP_NUMBER.test(name))     return 'google_business'
  if (GOOGLE_AD_NUMBER.test(name)) return 'google_ads_call'
  if (META_NUMBER.test(name))    return 'meta_ads_call'
  if (ORGANIC_NUMBER.test(name)) return 'organic_search'
  // A pool number is only ever shown to someone already on the website, so it places the caller
  // even when nothing says which channel brought them there. The pools endpoint tells us this
  // properly; when it is refused, a name that says "pool" or "call tracking" is the same fact
  // written by hand. Tested after the channel rules, so "GBP Call Tracking" stays a listing call.
  if (inPool || SOURCE_NUMBER_POOL.test(name)) return 'website_call'
  return null
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
  /** The CRM recorded these as a file import or as entered by hand. Not marketing. */
  internal:  number
  untracked: number
  channels:  { key: LeadSourceKey; label: string; group: LeadSourceGroup; count: number }[]
}

export function summariseLeadSources(counts: LeadSourceCounts): LeadSourceSummary {
  const channels = LEAD_SOURCES
    .map(s => ({ ...s, count: counts[s.key] ?? 0 }))
    .filter(c => c.count > 0)
    .sort((a, b) => b.count - a.count)
  const sum = (g: LeadSourceGroup) => channels.filter(c => c.group === g).reduce((s, c) => s + c.count, 0)
  const paid = sum('paid'), organic = sum('organic'), internal = sum('internal'), untracked = sum('untracked')
  return { total: paid + organic + internal + untracked, paid, organic, internal, untracked, channels }
}
