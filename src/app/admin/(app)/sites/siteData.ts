// Shared types and small pure helpers for the Sites page and its components.

export interface Site {
  id:               string
  name:             string
  url:              string
  platform:         string
  hosting_type:     string
  hosting_provider: string | null
  server_account:   string | null
  status:           string
  notes:            string | null
  is_up:            boolean | null
  last_checked_at:  string | null
  last_status_code: number | null
  last_response_ms: number | null
  uptime_7d:        number | null
  ssl_days_remaining: number | null
  ssl_expires_at:   string | null
  consecutive_failures: number
  client_id:        string | null
  group_id:         string | null
  discord_channel_id: string | null
  clients:          { id: string; name: string } | null
  site_groups:      { id: string; name: string } | null
  audit_enabled:    boolean
  audit_scope:      string
  last_audit_at:    string | null
  audit_score:      number | null
  audit_errors:     number | null
  audit_warnings:   number | null
}

export interface Group  { id: string; name: string }
export interface Client { id: string; name: string; website: string | null }

export interface AuditPageRow {
  url: string; score: number | null
  errors: number; warnings: number; title: string | null
  h1_count: number; has_schema: boolean; has_canonical: boolean
  issues: { type: string; sev: string; msg: string }[]
}

/** One row of site_check_daily. */
export interface DailyRow {
  site_id:        string
  date:           string
  uptime_pct:     number | null
  check_count:    number | null
  incident_count: number | null
}

/** One row of site_incidents. */
export interface IncidentRow {
  id:         string
  site_id:    string
  started_at: string
  ended_at:   string | null
  duration_s: number | null
  cause:      string | null
}

// vercel.json runs /api/cron/uptime-check every 2 minutes.
export const CHECK_INTERVAL_LABEL = 'every 2 minutes'
export const HISTORY_DAYS = 30

/**
 * down     — the cron has declared it down (3 failed checks in a row)
 * degraded — failing checks, not yet declared down
 * pending  — active but never checked
 * paused   — paused or archived, not monitored
 */
export type SiteState = 'down' | 'degraded' | 'up' | 'pending' | 'paused'

export function siteState(s: Site): SiteState {
  if (s.status !== 'active')              return 'paused'
  if (s.is_up === false)                  return 'down'
  if ((s.consecutive_failures ?? 0) > 0)  return 'degraded'
  if (s.is_up === null)                   return 'pending'
  return 'up'
}

export function stateLabel(s: Site, state = siteState(s)): string {
  switch (state) {
    case 'down':     return 'Down'
    case 'degraded': return 'Degraded'
    case 'pending':  return 'Pending'
    case 'paused':   return s.status === 'archived' ? 'Archived' : 'Paused'
    default:         return 'Up'
  }
}

/** Down first, then degraded, unchecked, up, and paused/archived last; alphabetical within each. */
export const STATE_RANK: Record<SiteState, number> = { down: 0, degraded: 1, pending: 2, up: 3, paused: 4 }

export function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

export function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '—'
  const diff = Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000))
  if (diff < 60)    return 'just now'
  if (diff < 3600)  return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`
  const days = Math.floor(diff / 86400)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

export function fmtPct(n: number): string {
  if (n >= 99.995) return '100%'
  return `${n >= 99 ? n.toFixed(2) : n.toFixed(1)}%`
}

export type Tone = 'green' | 'amber' | 'red' | 'muted'

export function uptimeTone(pct: number | null): Tone {
  if (pct == null) return 'muted'
  return pct >= 99 ? 'green' : pct >= 95 ? 'amber' : 'red'
}

/** Amber at 30 days or fewer, red at 7 or fewer (or expired). */
export function sslTone(days: number | null): Tone {
  if (days == null) return 'muted'
  return days <= 7 ? 'red' : days <= 30 ? 'amber' : 'muted'
}

export function scoreTone(score: number): Tone {
  return score >= 80 ? 'green' : score >= 60 ? 'amber' : 'red'
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** The last `n` UTC dates, oldest first, as YYYY-MM-DD — the dates site_check_daily is keyed by. */
export function lastNDates(n: number, now = Date.now()): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(new Date(now - i * 86_400_000).toISOString().slice(0, 10))
  return out
}

export function shortDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function fmtDuration(seconds: number): string {
  if (seconds < 60)    return `${seconds}s`
  const mins = Math.round(seconds / 60)
  if (mins < 60)       return `${mins} min`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  if (hrs < 24)        return rem ? `${hrs} h ${rem} min` : `${hrs} h`
  const days = Math.floor(hrs / 24)
  return `${days} d ${hrs % 24} h`
}

export const CAUSE_LABELS: Record<string, string> = {
  timeout:            'Timed out',
  '4xx':              'Client error (4xx)',
  '5xx':              'Server error (5xx)',
  dns:                'DNS lookup failed',
  connection_refused: 'Connection refused',
  other:              'No response',
}

export function detectPlatform(url: string): string {
  const lower = url.toLowerCase()
  if (lower.includes('gohighlevel') || lower.includes('.ghl.'))  return 'ghl'
  if (lower.includes('bigcommerce'))                              return 'bigcommerce'
  if (lower.includes('myshopify'))                               return 'shopify'
  return 'custom'
}

export const PLATFORM_LABELS: Record<string, string> = {
  wordpress: 'WordPress', ghl: 'GHL', bigcommerce: 'BigCommerce', shopify: 'Shopify', custom: 'Custom', other: 'Other',
}
