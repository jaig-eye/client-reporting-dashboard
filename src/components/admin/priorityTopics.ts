// Shared shapes and wording for the Pipeline's priority topics (content_silos in the database, "silos"
// in the API). The UI says "priority topics" because that is what they do: an active set with
// keywords left takes the client's next open publish dates, one keyword per post, ahead of the usual
// topic picks. Nothing here talks to the server.

export interface PrioritySet {
  id:                    string
  name:                  string
  /** Only blog sets take publish dates; service and regular page sets are made on demand. */
  content_type?:         string | null
  description:           string | null
  hub_page_url:          string | null
  hub_page_title:        string | null
  inject_internal_links: boolean
  created_at:            string
  status:                string
  keywordTotal:          number
  keywordUnused:         number
  clusterCount:          number
  publishedCount:        number
  /** Links the team is asked to add by hand for a main-page set. See linkTasksOf. */
  pending_links?:        unknown[] | null
}

/**
 * One link the team adds by hand: on `from` (the main page, or the set's previous live post), a link
 * to the post that just went live. Nothing edits a live page automatically.
 */
export interface LinkTask {
  kind:      'hub' | 'previous'
  fromUrl:   string | null
  fromTitle: string
  url:       string
  title:     string
  anchor:    string
  addedAt:   string
  doneAt:    string | null
}

/**
 * The link checklist for a set, from `pending_links`. Older entries were only `{ url, title,
 * added_at }` and always meant "link this from the main page", so they read as that.
 */
export function linkTasksOf(set: Pick<PrioritySet, 'pending_links' | 'hub_page_url' | 'hub_page_title' | 'name'>): LinkTask[] {
  const out: LinkTask[] = []
  for (const raw of set.pending_links ?? []) {
    if (!raw || typeof raw !== 'object') continue
    const e = raw as Record<string, unknown>
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
    const kind = e.kind === 'previous' ? 'previous' : 'hub'
    const title = str(e.title) ?? str(e.url) ?? 'the new post'
    out.push({
      kind,
      fromUrl:   str(e.from_url) ?? (kind === 'hub' ? set.hub_page_url : null),
      fromTitle: str(e.from_title) ?? (kind === 'hub' ? (set.hub_page_title ?? 'the main page') : 'the previous post'),
      url:       str(e.url) ?? '',
      title,
      anchor:    str(e.anchor) ?? title,
      addedAt:   str(e.added_at) ?? '',
      doneAt:    str(e.done_at),
    })
  }
  return out
}

/** How many links are still to add. */
export const openLinkCount = (set: Parameters<typeof linkTasksOf>[0]) => linkTasksOf(set).filter(t => !t.doneAt).length

/** The next date the topic run will fill for this client, from GET /silos. */
export interface NextSlot {
  date:         string
  /** The day that date comes into the planning window. Null: it already has, and the next run fills it. */
  picksOn:      string | null
  /** Off means only a manual run fills dates. */
  autoGenerate: boolean
}

export interface SetKeyword {
  id:         string
  keyword:    string
  used_at:    string | null
  sort_order: number
  selected?:  boolean
  post:  { id: string; title: string | null; status: string; published_url: string | null; target_publish_date: string | null } | null
  topic: { id: string; topic: string; status: string; target_publish_date?: string | null } | null
}

export type KeywordState = 'waiting' | 'picked' | 'written' | 'live'

/** Where one keyword is: waiting, topic picked, post written, or live. Once written it is never used again. */
export function stateOf(k: SetKeyword): KeywordState {
  if (k.post?.published_url) return 'live'
  if (k.post) return 'written'
  if (k.used_at || k.topic) return 'picked'
  return 'waiting'
}

/**
 * A set with a main page. It is written from its keywords like any other set and is done when they
 * run out; the main page only adds linking — each post links to it and to the set's earlier live
 * posts, and the team gets a checklist of links to add by hand.
 */
export const isHub = (s: Pick<PrioritySet, 'hub_page_url'>) => !!s.hub_page_url

/** Whether the topic run fills publish dates from this set. It only takes blog sets. */
export const takesDates = (s: Pick<PrioritySet, 'content_type'>) => (s.content_type ?? 'blog') === 'blog'

/** Oldest set first — the order the topic run takes them in. */
export function inRunOrder<T extends { created_at: string }>(sets: T[]): T[] {
  return [...sets].sort((a, b) => a.created_at.localeCompare(b.created_at))
}

/** Which set takes the next date: the oldest blog set that still has keywords waiting. */
export function nextUpId(sets: PrioritySet[]): string | null {
  return inRunOrder(sets).find(s => takesDates(s) && s.keywordUnused > 0)?.id ?? null
}

/** One keyword per line, trimmed, repeats dropped (case-insensitive) — what the server will keep. */
export function parseKeywordLines(text: string): { keywords: string[]; repeats: number } {
  const seen = new Set<string>()
  const keywords: string[] = []
  let repeats = 0
  for (const line of text.split(/\r?\n/)) {
    const k = line.trim().replace(/\s+/g, ' ')
    if (!k) continue
    const key = k.toLowerCase()
    if (seen.has(key)) { repeats++; continue }
    seen.add(key)
    keywords.push(k)
  }
  return { keywords, repeats }
}

/** Most keywords one request keeps; matches the API. */
export const MAX_KEYWORDS = 200
/** Notes are capped at this many characters by the API. */
export const MAX_NOTES = 1000

/** "Tue, Oct 27" for a YYYY-MM-DD publish date. Read in UTC, as stored, so it never slips a day. */
export function fmtPublishDay(date: string | null | undefined): string {
  if (!date) return ''
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return date
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear()
  return d.toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC', ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/**
 * Whether "Pick topics now" can do anything: the next open date is already inside the planning
 * window (the run would get to it within a couple of hours anyway), or automatic topics are off, so
 * only a person filling dates will ever fill one. Outside that, the window is full and a manual run
 * finds nothing to fill.
 */
export function canPickNow(slot: NextSlot | null): boolean {
  return !!slot && (slot.picksOn === null || !slot.autoGenerate)
}
