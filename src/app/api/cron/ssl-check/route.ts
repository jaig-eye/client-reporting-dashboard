import { NextRequest, NextResponse } from 'next/server'
import { timingSafeCompare } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { sendDiscordMessage } from '@/lib/discord'
import { sendEmail } from '@/lib/email'
import tls from 'tls'

export const maxDuration = 300

interface SslInfo {
  issuer:     string | null
  expiresAt:  string | null
  daysLeft:   number | null
  error:      string | null
}

function checkSsl(hostname: string): Promise<SslInfo> {
  return new Promise(resolve => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const done = (result: SslInfo) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      socket.destroy()
      resolve(result)
    }

    const socket = tls.connect(
      { host: hostname, port: 443, servername: hostname, rejectUnauthorized: false },
      () => {
        try {
          const cert = socket.getPeerCertificate()
          if (!cert || !cert.valid_to) { done({ issuer: null, expiresAt: null, daysLeft: null, error: 'no_cert' }); return }
          const expiresAt = new Date(cert.valid_to)
          const daysLeft  = Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000)
          const rawIssuer = cert.issuer?.O ?? cert.issuer?.CN ?? null
          const issuer    = Array.isArray(rawIssuer) ? rawIssuer[0] ?? null : rawIssuer ?? null
          done({ issuer, expiresAt: expiresAt.toISOString(), daysLeft, error: null })
        } catch (e) {
          done({ issuer: null, expiresAt: null, daysLeft: null, error: e instanceof Error ? e.message : 'parse_error' })
        }
      }
    )

    socket.on('error', err => {
      done({ issuer: null, expiresAt: null, daysLeft: null, error: err.message })
    })

    timer = setTimeout(() => done({ issuer: null, expiresAt: null, daysLeft: null, error: 'timeout' }), 15_000)
  })
}

function extractHostname(rawUrl: string): string {
  try { return new URL(rawUrl).hostname } catch { return rawUrl }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!timingSafeCompare(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const checkedAt = new Date().toISOString()
  const db = createAdminClient()

  const [agencyRes, sitesRes] = await Promise.all([
    db.from('agency_settings')
      .select('discord_bot_token, notification_email, agency_name')
      .single(),
    db.from('sites')
      .select('id, name, url, client_id, ssl_days_remaining, clients(name, discord_channel_id)')
      .eq('status', 'active'),
  ])

  const botToken   = agencyRes.data?.discord_bot_token as string | null ?? null
  const alertEmail = agencyRes.data?.notification_email as string | null ?? null
  const agencyName = agencyRes.data?.agency_name as string | null ?? 'LaunchLocal'
  const sites      = sitesRes.data ?? []

  let warned = 0; let critical = 0

  // Fan out all TLS checks in parallel — wall-clock = slowest single check, not sum
  const sslResults = await Promise.allSettled(
    sites.map(site => {
      const hostname = extractHostname(site.url)
      if (!hostname || site.url.startsWith('http://')) {
        return Promise.resolve({ site, hostname: '', info: null as SslInfo | null })
      }
      return checkSsl(hostname).then(info => ({ site, hostname, info }))
    })
  )

  for (const result of sslResults) {
    if (result.status === 'rejected') continue
    const { site, hostname, info } = result.value

    if (!hostname || site.url.startsWith('http://')) {
      await db.from('sites').update({
        ssl_issuer:        null,
        ssl_expires_at:    null,
        ssl_days_remaining: null,
        ssl_last_checked:  checkedAt,
        updated_at:        checkedAt,
      }).eq('id', site.id)
      continue
    }

    if (!info) continue

    await db.from('sites').update({
      ssl_issuer:         info.issuer,
      ssl_expires_at:     info.expiresAt,
      ssl_days_remaining: info.daysLeft,
      ssl_last_checked:   checkedAt,
      updated_at:         checkedAt,
    }).eq('id', site.id)

    if (info.error === 'no_cert' || info.error === 'timeout') {
      // HTTP-only or unreachable for TLS — create info alert if not already flagged
      const { count } = await db.from('admin_alerts')
        .select('id', { count: 'exact', head: true })
        .eq('type', 'integration')
        .eq('meta->>site_id', site.id)
        .eq('meta->>alert_kind', 'ssl_no_cert')
        .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
      if (!count) {
        await db.from('admin_alerts').insert({
          type:        'integration',
          severity:    'info',
          client_id:   site.client_id,
          client_name: (site as Record<string, unknown> as { clients?: { name?: string } | null }).clients?.name ?? null,
          title:       `${site.name}: no SSL certificate`,
          body:        info.error === 'no_cert' ? 'No certificate returned from TLS handshake.' : 'TLS connection timed out.',
          meta:        { site_id: site.id, url: site.url, alert_kind: 'ssl_no_cert' },
          link_url:    `/admin/sites`,
        })
      }
      continue
    }

    if (info.daysLeft === null) continue

    let severity: string | null = null
    let alertKind: string | null = null

    if (info.daysLeft <= 0) {
      severity  = 'critical'
      alertKind = 'ssl_expired'
    } else if (info.daysLeft <= 7) {
      severity  = 'critical'
      alertKind = 'ssl_critical'
    } else if (info.daysLeft <= 30) {
      severity  = 'warning'
      alertKind = 'ssl_warning'
    }

    if (severity && alertKind) {
      // Deduplicate: skip if an alert for this site/kind already exists from the last 7 days
      const { count } = await db.from('admin_alerts')
        .select('id', { count: 'exact', head: true })
        .eq('type', 'integration')
        .eq('meta->>site_id', site.id)
        .eq('meta->>alert_kind', alertKind)
        .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString())

      if (!count) {
        const expiryLabel = info.daysLeft <= 0
          ? 'EXPIRED'
          : `expires in ${info.daysLeft} day${info.daysLeft === 1 ? '' : 's'}`
        const clientName = (site as Record<string, unknown> as { clients?: { name?: string } | null }).clients?.name ?? null
        const channelId  = (site as Record<string, unknown> as { clients?: { discord_channel_id?: string | null } | null }).clients?.discord_channel_id
          ?? process.env.DISCORD_UPTIME_CHANNEL_ID ?? null

        await db.from('admin_alerts').insert({
          type:        'integration',
          severity,
          client_id:   site.client_id,
          client_name: clientName,
          title:       `${site.name}: SSL ${expiryLabel}`,
          body:        `Certificate for ${hostname} ${expiryLabel} (issued by ${info.issuer ?? 'unknown'}).`,
          meta:        { site_id: site.id, url: site.url, hostname, days_left: info.daysLeft, issuer: info.issuer, alert_kind: alertKind },
          link_url:    `/admin/sites`,
        })

        const emoji = info.daysLeft <= 0 ? '🔴' : '🟡'
        const msg   = `${emoji} **SSL alert: ${site.name}** — cert ${expiryLabel}\nHost: ${hostname} | Issuer: ${info.issuer ?? 'unknown'}`
        if (botToken && channelId) await sendDiscordMessage(botToken, channelId, msg).catch(() => {})

        if (alertEmail) {
          await sendEmail({
            to:      alertEmail,
            subject: `[${agencyName}] SSL ${info.daysLeft <= 0 ? 'Expired' : 'Expiring'}: ${site.name}`,
            html:    `<p>SSL certificate for <strong>${site.name}</strong> (${hostname}) ${expiryLabel}.</p><p>Issuer: ${info.issuer ?? 'unknown'}<br>Expires: ${info.expiresAt ? new Date(info.expiresAt).toDateString() : 'N/A'}</p>`,
            text:    msg,
          }).catch(() => {})
        }

        if (severity === 'critical') critical++
        else warned++
      }
    }
  }

  await db.from('cron_heartbeats').upsert({
    cron_name:   'ssl-check',
    last_run_at: checkedAt,
    last_result: `checked ${sites.length} sites, ${warned} warnings, ${critical} critical`,
  })

  return NextResponse.json({ checked: sites.length, warned, critical })
}
