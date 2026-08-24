import { NextRequest, NextResponse } from 'next/server'
import { timingSafeCompare } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { sendDiscordMessage } from '@/lib/discord'
import { sendEmail } from '@/lib/email'
import { PLATFORM_BOT_UA } from '@/lib/platformBot'
import { getNotif }        from '@/lib/notificationConfig'

export const maxDuration = 300

const TIMEOUT_MS          = 15_000
const EXTENDED_TIMEOUT_MS = 30_000  // used on the 2nd+ check when a site already has a failure
const RETRY_DELAY_MS      = 3_000   // delay between the first and second attempt within one check
const MAX_ATTEMPTS        = 2       // attempts per check (1 retry); both must fail to count as DOWN

// Escalation ladder (cron runs every 2 min). Unambiguous causes (DNS failure, connection
// refused/reset, TLS, host unreachable, 5xx) mean the host actively rejected us — those still
// declare DOWN at 3 checks. Ambiguous causes (timeout, unclassified) usually mean the host is
// slow or congested, NOT offline — a busy site under load produces these constantly. They get
// a long runway: a quiet internal heads-up at 10 min, and a hard DOWN + @everyone only after
// 30 min of continuous failure.
const FLAP_THRESHOLD_CONFIRMED  = 3    // 6 min  — confirmed cause → DOWN
const INVESTIGATING_THRESHOLD   = 5    // 10 min — ambiguous cause → quiet, agency-only notice
const FLAP_THRESHOLD_AMBIGUOUS  = 15   // 30 min — ambiguous cause → DOWN
const CONFIRMED_CAUSES = new Set(['dns', 'connection_refused', 'connection_reset', 'tls', 'host_unreachable', '5xx'])

// Human-readable cause for alert text — "connection timeout" beats "other"/"timeout".
const CAUSE_LABELS: Record<string, string> = {
  timeout:            'connection timeout',
  dns:                'DNS lookup failed',
  connection_refused: 'connection refused',
  connection_reset:   'connection reset',
  host_unreachable:   'host unreachable',
  tls:                'TLS / certificate error',
  '5xx':              'server error',
  '4xx':              'client error',
  other:              'unknown network error',
}
function describeCause(cause: string, statusCode: number | null): string {
  if (statusCode) return `HTTP ${statusCode}`
  return CAUSE_LABELS[cause] ?? cause
}

// Browser-impersonating UA reduces WAF/Cloudflare false blocks.
// Clients can whitelist by UA string: http.user_agent contains "GoLaunchLocal"
const MONITOR_UA = `${PLATFORM_BOT_UA} LaunchLocal-Monitor/1.0 Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36`

interface SiteRow {
  id:                   string
  name:                 string
  url:                  string
  status:               string
  is_up:                boolean | null
  consecutive_failures: number
  client_id:            string | null
  discord_channel_id:   string | null
  clients:              { name: string; discord_channel_id: string | null } | null
}

interface CheckResult {
  siteId:       string
  isUp:         boolean
  statusCode:   number | null
  responseMs:   number | null
  finalUrl:     string | null
  error:        string | null
  errorDetail:  string | null
}

// Node's fetch (undici) throws `TypeError: fetch failed` at the top level — the real cause
// (ECONNRESET, EHOSTUNREACH, TLS errors, etc.) lives on `err.cause` (sometimes one level
// deeper), which a plain `err.message` check never sees. This inspects the wrapped cause and
// falls back to message-text matching only when no structured code is available.
function classifyError(err: unknown): { cause: string; detail: string } {
  const e       = err as { name?: string; message?: string; cause?: unknown }
  const message = e?.message ?? String(err)

  // AbortSignal.timeout() rejects with a DOMException named 'TimeoutError' — robust,
  // unlike matching the word "timeout" in a message that may not contain it.
  if (e?.name === 'TimeoutError') {
    return { cause: 'timeout', detail: message }
  }

  const inner  = (e?.cause ?? {}) as { code?: string; message?: string; cause?: { code?: string; message?: string } }
  const code   = inner.code ?? inner.cause?.code ?? null
  const detail = inner.message ?? inner.cause?.message ?? message

  const cause =
    code === 'ENOTFOUND' || code === 'EAI_AGAIN'                                ? 'dns'
    : code === 'ECONNREFUSED'                                                   ? 'connection_refused'
    : code === 'ECONNRESET' || code === 'EPIPE'                                 ? 'connection_reset'
    : code === 'EHOSTUNREACH' || code === 'ENETUNREACH'                         ? 'host_unreachable'
    : code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT'
      || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT'  ? 'timeout'
    : code && /^(CERT_|ERR_TLS_|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE)/.test(code) ? 'tls'
    : /socket hang up/i.test(detail)                                            ? 'connection_reset'
    : /timeout|timed out/i.test(message) || /timeout|timed out/i.test(detail)   ? 'timeout'
    : 'other'

  return { cause, detail }
}

async function pingUrl(url: string, timeoutMs = TIMEOUT_MS): Promise<Omit<CheckResult, 'siteId'>> {
  // Any 4xx means the server IS responding (auth wall, rate limit, not-found, etc.) = UP.
  // Only 5xx server errors = genuinely broken. 499 (nginx client disconnect) is 4xx → UP.
  let last: Omit<CheckResult, 'siteId'> = { isUp: false, statusCode: null, responseMs: null, finalUrl: null, error: 'other', errorDetail: null }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, RETRY_DELAY_MS))

    const start = Date.now()
    try {
      const res = await fetch(url, {
        signal:   AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
        headers:  {
          'User-Agent':      MONITOR_UA,
          'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
        },
      })
      const responseMs = Date.now() - start
      const isUp = res.status < 500
      last = { isUp, statusCode: res.status, responseMs, finalUrl: res.url, error: null, errorDetail: null }
      if (isUp) return last   // UP on any attempt → stop immediately
    } catch (err) {
      const responseMs = Date.now() - start
      const { cause, detail } = classifyError(err)
      last = { isUp: false, statusCode: null, responseMs, finalUrl: null, error: cause, errorDetail: detail }
    }
  }

  return last  // all attempts failed → DOWN
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!timingSafeCompare(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const checkedAt = new Date().toISOString()

  const [agencyRes, sitesRes] = await Promise.all([
    db.from('agency_settings')
      .select('discord_bot_token, discord_ops_channel_id, notification_email, agency_name, notification_config')
      .maybeSingle(),
    db.from('sites')
      .select('id, name, url, status, is_up, consecutive_failures, client_id, discord_channel_id, clients(name, discord_channel_id)')
      .eq('status', 'active'),
  ])

  const botToken        = agencyRes.data?.discord_bot_token as string | null ?? null
  const alertEmail      = agencyRes.data?.notification_email as string | null ?? null
  const agencyName      = agencyRes.data?.agency_name as string | null ?? 'LaunchLocal'
  const opsChannelId    = (agencyRes.data?.discord_ops_channel_id as string | null) ?? process.env.DISCORD_OPS_CHANNEL_ID ?? null
  const notifConfig     = (agencyRes.data?.notification_config as import('@/lib/notificationConfig').NotifConfig | null) ?? {}
  const sites      = (sitesRes.data ?? []) as unknown as SiteRow[]

  if (sites.length === 0) {
    await db.from('cron_heartbeats').upsert({ cron_name: 'uptime-check', last_run_at: checkedAt, last_result: 'no sites' })
    return NextResponse.json({ checked: 0 })
  }

  const results = await Promise.allSettled(
    sites.map(site => {
      // Sites already in a warning state (one failure recorded) get a longer timeout
      // so a genuinely slow homepage doesn't get falsely declared down.
      const timeoutMs = (site.consecutive_failures ?? 0) >= 1 ? EXTENDED_TIMEOUT_MS : TIMEOUT_MS
      return pingUrl(site.url, timeoutMs).then(r => ({ ...r, siteId: site.id } as CheckResult))
    })
  )

  // Pre-load all open incidents in ONE query — eliminates N+1 SELECT per down/recovering site.
  const { data: openIncidentsData } = await db
    .from('site_incidents')
    .select('id, site_id, started_at')
    .in('site_id', sites.map(s => s.id))
    .is('ended_at', null)
  const openIncidentBySiteId = new Map(
    (openIncidentsData ?? []).map(i => [i.site_id, i] as [string, { id: string; site_id: string; started_at: string }])
  )

  // Batch site_checks inserts — collect all records then insert once after the loop.
  type SiteCheckRow = { site_id: string; checked_at: string; is_up: boolean; status_code: number | null; response_ms: number | null; final_url: string | null; error: string | null; error_detail: string | null }
  const siteChecksToInsert: SiteCheckRow[] = []

  const today = checkedAt.slice(0, 10)

  let downtimeAlerts = 0
  let recoveryAlerts = 0

  for (let i = 0; i < sites.length; i++) {
    const site   = sites[i]
    const result = results[i]
    if (result.status === 'rejected') continue

    const { isUp, statusCode, responseMs, finalUrl, error, errorDetail } = result.value

    siteChecksToInsert.push({
      site_id:     site.id,
      checked_at:  checkedAt,
      is_up:       isUp,
      status_code: statusCode,
      response_ms: responseMs,
      final_url:   finalUrl,
      error,
      error_detail: errorDetail,
    })

    const wasDown = site.is_up === false
    // Client-level channel for per-client Discord notifications.
    const clientChannelId = site.discord_channel_id ?? site.clients?.discord_channel_id ?? null

    if (!isUp) {
      const newFailCount = (site.consecutive_failures ?? 0) + 1

      // Resolve the final cause for this check: pingUrl's `error` covers thrown exceptions;
      // a non-throwing 5xx/4xx response has error=null and is resolved from statusCode here.
      const cause = error ?? (statusCode && statusCode >= 500 ? '5xx' : statusCode && statusCode >= 400 ? '4xx' : 'other')
      const isConfirmed       = CONFIRMED_CAUSES.has(cause)
      const requiredThreshold = isConfirmed ? FLAP_THRESHOLD_CONFIRMED : FLAP_THRESHOLD_AMBIGUOUS

      // Only flip is_up to false when the threshold is first crossed; the is_up !== false guard
      // prevents re-alerting on every subsequent check while the site stays down.
      const thresholdCrossed = newFailCount >= requiredThreshold && site.is_up !== false
      // Ambiguous cause (timeout/other) has persisted long enough to be worth a look, but not
      // long enough to call the site down — one quiet, internal heads-up, no page, no incident.
      // Fires exactly once (consecutive_failures increments by 1 per run, so === can't be skipped).
      const investigating = !thresholdCrossed && !isConfirmed
        && newFailCount === INVESTIGATING_THRESHOLD && site.is_up !== false

      await db.from('sites').update({
        ...(thresholdCrossed ? { is_up: false } : {}),
        last_checked_at:      checkedAt,
        last_status_code:     statusCode,
        last_response_ms:     responseMs,
        consecutive_failures: newFailCount,
        updated_at:           checkedAt,
      }).eq('id', site.id)

      // Flap threshold crossed — declare DOWN and alert
      if (thresholdCrossed) {
        // Open incident — guard against duplicate open incidents on overlapping cron runs
        const existingIncident = openIncidentBySiteId.get(site.id)
        if (!existingIncident) {
          await db.from('site_incidents').insert({
            site_id:      site.id,
            started_at:   checkedAt,
            cause,
            error_detail: errorDetail,
          })
          // Track the new incident so recovery logic in this same run can find it
          openIncidentBySiteId.set(site.id, { id: 'pending', site_id: site.id, started_at: checkedAt })
        }

        // admin_alerts row
        await db.from('admin_alerts').insert({
          type:        'integration',
          severity:    'critical',
          client_id:   site.client_id,
          client_name: site.clients?.name ?? null,
          title:       `${site.name} is DOWN`,
          body:        `${site.url} — ${describeCause(cause, statusCode)}${errorDetail ? ` (${errorDetail})` : ''}`,
          meta:        { site_id: site.id, url: site.url, status_code: statusCode, error, cause, error_detail: errorDetail },
          link_url:    `/admin/sites`,
        })

        // Ambiguous causes only reach here after the long grace window — say so, so the reader
        // knows this is a sustained failure and not an instant trip.
        const forMins = newFailCount * 2
        const msg = `@everyone 🔴 **${site.name} is DOWN** — ${site.url}\n`
          + `Cause: ${describeCause(cause, statusCode)} | Failing for ~${forMins} min | Detected: ${new Date(checkedAt).toUTCString()}`
        const notifDown = getNotif(notifConfig, 'uptime_down')
        if (notifDown.agency  && botToken && opsChannelId)    await sendDiscordMessage(botToken, opsChannelId,    msg).catch(() => {})
        if (notifDown.client  && botToken && clientChannelId) await sendDiscordMessage(botToken, clientChannelId, msg).catch(() => {})

        if (alertEmail && notifDown.email) {
          await sendEmail({
            to:      alertEmail,
            subject: `[${agencyName}] Site DOWN: ${site.name}`,
            html:    `<p><strong>${site.name}</strong> is down.</p><p>URL: ${site.url}<br>Cause: ${describeCause(cause, statusCode)}${errorDetail ? ` (${errorDetail})` : ''}<br>Failing for: ~${forMins} min<br>Time: ${new Date(checkedAt).toUTCString()}</p>`,
            text:    msg,
          }).catch(() => {})
        }

        downtimeAlerts++
      } else if (investigating) {
        // Quiet, non-paging heads-up only — no @everyone, no incident, no is_up flip.
        // Escalates to the DOWN path above if it keeps failing past FLAP_THRESHOLD_AMBIGUOUS,
        // or immediately if a subsequent check comes back with a confirmed cause.
        // Goes to the same channels as a DOWN alert (ops + the per-client channel) so it lands
        // where that site's chatter already lives — just without the @everyone page. Toggle
        // either channel off under Notifications → "Performance degradation".
        const mins = INVESTIGATING_THRESHOLD * 2
        const msg = `🟡 **${site.name} — performance degradation** (not down)\n${describeCause(cause, statusCode)} for ~${mins} min. Monitoring; will page only if it persists. | ${site.url}`
        const notifInvestigating = getNotif(notifConfig, 'uptime_investigating')
        if (notifInvestigating.agency && botToken && opsChannelId)    await sendDiscordMessage(botToken, opsChannelId,    msg).catch(() => {})
        if (notifInvestigating.client && botToken && clientChannelId) await sendDiscordMessage(botToken, clientChannelId, msg).catch(() => {})
      }
    } else {
      // Site is up. Always reset the failure streak — any passing check breaks it.
      // This means a site alternating fail/pass never accumulates toward the flap threshold,
      // which is the correct flap-suppression behaviour.
      const wasInvestigating = !wasDown && (site.consecutive_failures ?? 0) >= INVESTIGATING_THRESHOLD

      await db.from('sites').update({
        is_up:                true,
        last_checked_at:      checkedAt,
        last_status_code:     statusCode,
        last_response_ms:     responseMs,
        consecutive_failures: 0,
        updated_at:           checkedAt,
      }).eq('id', site.id)

      // Was flagged "performance degradation" but never crossed into a confirmed DOWN —
      // close the loop with a quiet resolved note instead of silence, on the same channels.
      if (wasInvestigating) {
        const msg = `✅ **${site.name} recovered** — degradation cleared, site responding normally | ${site.url}`
        const notifInvestigating = getNotif(notifConfig, 'uptime_investigating')
        if (notifInvestigating.agency && botToken && opsChannelId)    await sendDiscordMessage(botToken, opsChannelId,    msg).catch(() => {})
        if (notifInvestigating.client && botToken && clientChannelId) await sendDiscordMessage(botToken, clientChannelId, msg).catch(() => {})
      }

      // Recovery — was down, now up
      if (wasDown) {
        // Close open incident using pre-loaded map (no per-site DB call)
        const openIncident = openIncidentBySiteId.get(site.id)

        if (openIncident && openIncident.id !== 'pending') {
          const durationS = Math.floor((new Date(checkedAt).getTime() - new Date(openIncident.started_at).getTime()) / 1000)
          await db.from('site_incidents').update({
            ended_at:   checkedAt,
            duration_s: durationS,
          }).eq('id', openIncident.id)

          const downMins = Math.round(durationS / 60)
          const msg = `🟢 **${site.name} recovered** — was down ${downMins} min | ${site.url}`
          const notifRecovered = getNotif(notifConfig, 'uptime_recovered')
          if (notifRecovered.agency  && botToken && opsChannelId)    await sendDiscordMessage(botToken, opsChannelId,    msg).catch(() => {})
          if (notifRecovered.client  && botToken && clientChannelId) await sendDiscordMessage(botToken, clientChannelId, msg).catch(() => {})

          if (alertEmail && notifRecovered.email) {
            await sendEmail({
              to:      alertEmail,
              subject: `[${agencyName}] Site recovered: ${site.name}`,
              html:    `<p><strong>${site.name}</strong> has recovered after ${downMins} minute(s).</p><p>URL: ${site.url}</p>`,
              text:    msg,
            }).catch(() => {})
          }

          recoveryAlerts++
        }
      }
    }
  }

  // Batch insert all site_checks rows in one call (was one INSERT per site)
  if (siteChecksToInsert.length > 0) {
    await db.from('site_checks').insert(siteChecksToInsert)
  }

  // Daily rollup — upsert today's stats per site
  // Use tomorrow's midnight as the upper bound; `T24:00:00Z` is rejected by PostgreSQL.
  const todayStart    = today + 'T00:00:00Z'
  const tomorrowStart = new Date(new Date(todayStart).getTime() + 86_400_000).toISOString().slice(0, 10) + 'T00:00:00Z'

  const [rollupRes, incidentRes] = await Promise.all([
    db.from('site_checks')
      .select('site_id, is_up, response_ms')
      .gte('checked_at', todayStart)
      .lt('checked_at',  tomorrowStart),
    db.from('site_incidents')
      .select('site_id')
      .gte('started_at', todayStart)
      .lt('started_at',  tomorrowStart),
  ])

  const bySite = new Map<string, { total: number; up: number; totalMs: number }>()
  for (const row of rollupRes.data ?? []) {
    const s = bySite.get(row.site_id) ?? { total: 0, up: 0, totalMs: 0 }
    s.total++
    if (row.is_up) s.up++
    s.totalMs += row.response_ms ?? 0
    bySite.set(row.site_id, s)
  }

  const incidentsBySite = new Map<string, number>()
  for (const row of incidentRes.data ?? []) {
    incidentsBySite.set(row.site_id, (incidentsBySite.get(row.site_id) ?? 0) + 1)
  }

  if (bySite.size > 0) {
    await db.from('site_check_daily').upsert(
      Array.from(bySite.entries()).map(([siteId, stats]) => ({
        site_id:         siteId,
        date:            today,
        uptime_pct:      stats.total > 0 ? (stats.up / stats.total) * 100 : null,
        avg_response_ms: stats.total > 0 ? Math.round(stats.totalMs / stats.total) : null,
        check_count:     stats.total,
        incident_count:  incidentsBySite.get(siteId) ?? 0,
      })),
      { onConflict: 'site_id,date' }
    )
  }

  // Compute 7-day uptime per site and update sites table
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
  const weeklyRes = await db
    .from('site_check_daily')
    .select('site_id, uptime_pct, check_count')
    .gte('date', sevenDaysAgo)

  const weekly = new Map<string, { weightedSum: number; totalChecks: number }>()
  for (const row of weeklyRes.data ?? []) {
    const w = weekly.get(row.site_id) ?? { weightedSum: 0, totalChecks: 0 }
    w.weightedSum  += (row.uptime_pct ?? 0) * (row.check_count ?? 1)
    w.totalChecks  += row.check_count ?? 1
    weekly.set(row.site_id, w)
  }

  await Promise.all(
    Array.from(weekly.entries()).map(([siteId, w]) =>
      db.from('sites').update({
        uptime_7d:  w.totalChecks > 0 ? w.weightedSum / w.totalChecks : null,
        updated_at: checkedAt,
      }).eq('id', siteId)
    )
  )

  // Prune raw checks older than 7 days
  const pruneBefore = new Date(Date.now() - 7 * 86_400_000).toISOString()
  await db.from('site_checks').delete().lt('checked_at', pruneBefore)

  // Heartbeat
  await db.from('cron_heartbeats').upsert({
    cron_name:   'uptime-check',
    last_run_at: checkedAt,
    last_result: `checked ${sites.length} sites, ${downtimeAlerts} down alerts, ${recoveryAlerts} recoveries`,
  })

  return NextResponse.json({ checked: sites.length, downtimeAlerts, recoveryAlerts })
}
