// Pure helpers for the Alerts inbox: filtering, collapsing repeats, and day grouping.
//
// Production has ~1000 open alerts and most of them are the same cron firing every day for the same
// client ("Ad Fuel low — Irrigation Inc"). Nothing here touches the database — repeats are collapsed
// on the client, from whatever has been loaded.

export interface Alert {
  id:          string
  type:        string
  severity:    string
  client_id:   string | null
  client_name: string | null
  title:       string
  body:        string | null
  meta:        Record<string, unknown>
  link_url:    string | null
  read_at:     string | null
  created_at:  string
}

/** The light row every open alert contributes, so counts, the client list and bulk actions cover
 *  all ~1000 alerts even though only a page of full alerts is loaded at a time. */
export interface AlertIndexRow {
  id:          string
  type:        string
  severity:    string
  client_id:   string | null
  client_name: string | null
  read_at:     string | null
  created_at:  string
}

export interface InboxFilter {
  tab:        string   // 'all' or an alert type
  client:     string   // '' or a client_id
  unreadOnly: boolean
}

export function matchesFilter(row: AlertIndexRow, f: InboxFilter, ignoreUnread = false): boolean {
  if (f.tab !== 'all' && row.type !== f.tab) return false
  if (f.client && row.client_id !== f.client) return false
  if (!ignoreUnread && f.unreadOnly && row.read_at != null) return false
  return true
}

// ─── Titles & repeats ─────────────────────────────────────────────────────────

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

/** The title without a trailing " — Client Name": the client is already shown beside it. */
export function displayTitle(a: Pick<Alert, 'title' | 'client_name'>): string {
  const name = a.client_name?.trim()
  if (!name) return a.title
  const n = escapeRe(name)
  // "Ad Fuel low — Client" and "Client: SSL expires in 12 days" both drop the client.
  const stripped = a.title
    .replace(new RegExp(`\\s*[—–:-]\\s*${n}\\s*$`, 'i'), '')
    .replace(new RegExp(`^\\s*${n}\\s*[:—–-]\\s*`, 'i'), '')
    .trim()
  if (!stripped) return a.title
  return stripped.charAt(0).toUpperCase() + stripped.slice(1)
}

/** What stays the same when a cron repeats itself: the title minus the client and any numbers. */
export function titleStem(a: Pick<Alert, 'title' | 'client_name'>): string {
  let t = displayTitle(a).toLowerCase()
  const name = a.client_name?.trim().toLowerCase()
  if (name) t = t.split(name).join(' ')
  return t
    .replace(/[$£€]?\d[\d,.]*\s*(%|k|d|days?)?/g, '#')
    .replace(/[^a-z#▲▼]+/g, ' ')
    .trim()
}

const SEVERITY_RANK: Record<string, number> = { critical: 3, warning: 2, info: 1 }
export const severityRank = (s: string) => SEVERITY_RANK[s] ?? 1

export interface AlertGroup {
  key:      string
  /** Newest first. items[0] is the one the row shows. */
  items:    Alert[]
  latest:   Alert
  unread:   number
  severity: string
}

/** A repeat more than this long after the previous one is a new episode, so it gets its own row. */
const RUN_GAP_MS = 3 * 86_400_000

/**
 * Collapse repeats. Walking newest → oldest, an alert joins the row for its type + client + title
 * stem when it is within three days of that row's oldest alert. Other alerts landing in between do
 * not break the run — a daily "Ad Fuel low" stays one row even when a budget alert for the same
 * client arrives the same morning. A gap of more than three days starts a new row.
 */
export function collapseRepeats(alerts: Alert[]): AlertGroup[] {
  const groups: AlertGroup[] = []
  const open = new Map<string, AlertGroup>()

  for (const a of alerts) {
    const key  = `${a.type}|${a.client_id ?? a.client_name ?? `solo:${a.id}`}|${titleStem(a)}`
    const run  = open.get(key)
    const last = run?.items[run.items.length - 1]
    if (run && last && new Date(last.created_at).getTime() - new Date(a.created_at).getTime() <= RUN_GAP_MS) {
      run.items.push(a)
      if (a.read_at == null) run.unread++
      if (severityRank(a.severity) > severityRank(run.severity)) run.severity = a.severity
      continue
    }
    const group: AlertGroup = {
      key: `${key}|${a.id}`,
      items: [a],
      latest: a,
      unread: a.read_at == null ? 1 : 0,
      severity: a.severity,
    }
    groups.push(group)
    open.set(key, group)
  }
  return groups
}

// ─── Days & time ──────────────────────────────────────────────────────────────

function startOfDay(ms: number) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime() }

export function dayLabel(iso: string, now: number): string {
  const day   = startOfDay(new Date(iso).getTime())
  const today = startOfDay(now)
  const diff  = Math.round((today - day) / 86_400_000)
  if (diff <= 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  const d = new Date(iso)
  if (diff < 7) return d.toLocaleDateString('en-US', { weekday: 'long' })
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

export interface DaySection { label: string; groups: AlertGroup[]; alertCount: number }

/** Groups are already newest-first, so each sits under the day of its latest alert. */
export function sectionByDay(groups: AlertGroup[], now: number): DaySection[] {
  const out: DaySection[] = []
  for (const g of groups) {
    const label = dayLabel(g.latest.created_at, now)
    let sec = out[out.length - 1]
    if (!sec || sec.label !== label) { sec = { label, groups: [], alertCount: 0 }; out.push(sec) }
    sec.groups.push(g)
    sec.alertCount += g.items.length
  }
  return out
}

export function relativeTime(iso: string, now: number): string {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000)
  if (mins < 1)  return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7)  return `${days}d`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function fullTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function isToday(iso: string, now: number) {
  return startOfDay(new Date(iso).getTime()) === startOfDay(now)
}
