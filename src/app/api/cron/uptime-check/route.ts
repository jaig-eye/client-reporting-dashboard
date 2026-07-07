import { NextRequest, NextResponse } from 'next/server'
import { timingSafeCompare } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { sendDiscordMessage } from '@/lib/discord'
import { sendEmail } from '@/lib/email'

export const maxDuration = 300

const TIMEOUT_MS = 15_000
const FLAP_THRESHOLD = 2

// Browser-impersonating UA reduces WAF/Cloudflare false blocks.
// Prefix "LaunchLocal-Monitor" lets clients whitelist by UA string in
// their Cloudflare "Skip" rule (WAF + Bot Fight Mode + rate limiting).
const MONITOR_UA = 'LaunchLocal-Monitor/1.0 Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

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
}

async function pingUrl(url: string): Promise<Omit<CheckResult, 'siteId'>> {
  const start = Date.now()
  try {
    const res = await fetch(url, {
      signal:   AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow',
      headers:  {
        'User-Agent':      MONITOR_UA,
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
      },
    })
    const responseMs = Date.now() - start
    // 401/403 = auth-gated or WAF challenge page — server is up.
    // 429 = monitor is rate-limited, not the site broken — count as UP to avoid false alerts.
    // 404, 5xx = site genuinely broken.
    const isUp = res.status < 400 || res.status === 401 || res.status === 403 || res.status === 429
    return { isUp, statusCode: res.status, responseMs, finalUrl: res.url, error: null }
  } catch (err) {
    const responseMs = Date.now() - start
    const msg = err instanceof Error ? err.message : String(err)
    const cause = msg.includes('timeout') ? 'timeout'
      : msg.includes('ENOTFOUND') ? 'dns'
      : msg.includes('ECONNREFUSED') ? 'connection_refused'
      : 'other'
    return { isUp: false, statusCode: null, responseMs, finalUrl: null, error: cause }
  }
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
      .select('discord_bot_token, notification_email, agency_name')
      .single(),
    db.from('sites')
      .select('id, name, url, status, is_up, consecutive_failures, client_id, discord_channel_id, clients(name, discord_channel_id)')
      .eq('status', 'active'),
  ])

  const botToken   = agencyRes.data?.discord_bot_token as string | null ?? null
  const alertEmail = agencyRes.data?.notification_email as string | null ?? null
  const agencyName = agencyRes.data?.agency_name as string | null ?? 'LaunchLocal'
  const sites      = (sitesRes.data ?? []) as unknown as SiteRow[]

  if (sites.length === 0) {
    await db.from('cron_heartbeats').upsert({ cron_name: 'uptime-check', last_run_at: checkedAt, last_result: 'no sites' })
    return NextResponse.json({ checked: 0 })
  }

  // Ping all sites concurrently
  const results = await Promise.allSettled(
    sites.map(site => pingUrl(site.url).then(r => ({ ...r, siteId: site.id } as CheckResult)))
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
  type SiteCheckRow = { site_id: string; checked_at: string; is_up: boolean; status_code: number | null; response_ms: number | null; final_url: string | null; error: string | null }
  const siteChecksToInsert: SiteCheckRow[] = []

  const today = new Date().toISOString().slice(0, 10)

  let downtimeAlerts = 0
  let recoveryAlerts = 0

  for (let i = 0; i < sites.length; i++) {
    const site   = sites[i]
    const result = results[i]
    if (result.status === 'rejected') continue

    const { isUp, statusCode, responseMs, finalUrl, error } = result.value

    // Collect raw check for batch insert after loop
    siteChecksToInsert.push({
      site_id:     site.id,
      checked_at:  checkedAt,
      is_up:       isUp,
      status_code: statusCode,
      response_ms: responseMs,
      final_url:   finalUrl,
      error,
    })

    const wasDown = site.is_up === false

    if (!isUp) {
      const newFailCount = (site.consecutive_failures ?? 0) + 1
      // Only flip is_up to false when the threshold is first crossed.
      // Setting it on failure #1 made wasUp always false on failure #2, so alerts never fired.
      const thresholdCrossed = newFailCount >= FLAP_THRESHOLD && site.is_up !== false

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
        const cause = error === 'timeout' ? 'timeout'
          : error === 'dns' ? 'dns'
          : error === 'connection_refused' ? 'connection_refused'
          : statusCode && statusCode >= 500 ? '5xx'
          : statusCode && statusCode >= 400 ? '4xx'
          : 'other'

        // Open incident — guard against duplicate open incidents on overlapping cron runs
        const existingIncident = openIncidentBySiteId.get(site.id)
        if (!existingIncident) {
          await db.from('site_incidents').insert({
            site_id:    site.id,
            started_at: checkedAt,
            cause,
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
          body:        `${site.url} returned ${statusCode ?? error ?? 'error'}`,
          meta:        { site_id: site.id, url: site.url, status_code: statusCode, error, cause },
          link_url:    `/admin/sites`,
        })

        const msg = `@everyone 🔴 **${site.name} is DOWN** — ${site.url}\nStatus: ${statusCode ?? error ?? 'no response'} | Detected: ${new Date().toUTCString()}`
        const channelId = site.discord_channel_id ?? site.clients?.discord_channel_id ?? process.env.DISCORD_UPTIME_CHANNEL_ID ?? null
        await sendDiscordMessage(botToken, channelId, msg)

        if (alertEmail) {
          await sendEmail({
            to:      alertEmail,
            subject: `[${agencyName}] Site DOWN: ${site.name}`,
            html:    `<p><strong>${site.name}</strong> is down.</p><p>URL: ${site.url}<br>Status: ${statusCode ?? error ?? 'no response'}<br>Time: ${new Date().toUTCString()}</p>`,
            text:    msg,
          }).catch(() => {})
        }

        downtimeAlerts++
      }
    } else {
      // Site is up
      await db.from('sites').update({
        is_up:                true,
        last_checked_at:      checkedAt,
        last_status_code:     statusCode,
        last_response_ms:     responseMs,
        consecutive_failures: 0,
        updated_at:           checkedAt,
      }).eq('id', site.id)

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
          const channelId = site.discord_channel_id ?? site.clients?.discord_channel_id ?? process.env.DISCORD_UPTIME_CHANNEL_ID ?? null
          await sendDiscordMessage(botToken, channelId, msg)

          if (alertEmail) {
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

  for (const [siteId, stats] of Array.from(bySite.entries())) {
    await db.from('site_check_daily').upsert({
      site_id:         siteId,
      date:            today,
      uptime_pct:      stats.total > 0 ? (stats.up / stats.total) * 100 : null,
      avg_response_ms: stats.total > 0 ? Math.round(stats.totalMs / stats.total) : null,
      check_count:     stats.total,
      incident_count:  incidentsBySite.get(siteId) ?? 0,
    }, { onConflict: 'site_id,date' })
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
