// GET /api/cron/contact-staleness
//
// Daily: flag clients we have not spoken to inside their contact window.
//
// Threshold resolution is the usual per-client-override-then-agency-default:
//   clients.contact_stale_days ?? agency_settings.contact_stale_days (default 14)
//
// DELIBERATELY OPS-CHANNEL ONLY. Uptime alerts go to a client's own Discord
// channel because the client cares that their site is down. This alert is about
// OUR follow-up discipline — "nobody has called them in 30 days" must never
// reach the client. The notification key is registered with hasClient:false so
// the per-client toggle is not even offered in settings.

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeCompare }          from '@/lib/auth'
import { createAdminClient }          from '@/lib/supabase/server'
import { sendDiscordMessage }         from '@/lib/discord'
import { sendEmail }                  from '@/lib/email'
import { getNotif, type NotifConfig } from '@/lib/notificationConfig'
import { buildAgencyEmail, escapeEmailHtml } from '@/lib/content/emailTemplates'

export const maxDuration = 60

const DAY_MS = 86_400_000

interface ClientRow {
  id:                    string
  name:                  string
  temperature:           string | null
  last_contacted_at:     string | null
  contact_stale_days:    number | null
  last_contact_alert_at: string | null
}

/** High-attention clients lead the digest — they are the ones that hurt to forget. */
const TEMP_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

export async function GET(request: NextRequest) {
  // The CRON_SECRET presence check is separate on purpose. Interpolating an
  // unset var produces the literal string "Bearer undefined", which is truthy —
  // so timingSafeCompare's own `!expected` guard never fires and anyone sending
  // `Authorization: Bearer undefined` is let in. Check the var itself first.
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || !timingSafeCompare(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  const [settingsRes, clientsRes] = await Promise.all([
    db.from('agency_settings')
      .select('discord_bot_token, discord_ops_channel_id, notification_config, notification_email, contact_stale_days, agency_name')
      .maybeSingle(),
    db.from('clients')
      .select('id, name, temperature, last_contacted_at, contact_stale_days, last_contact_alert_at'),
  ])

  const settings    = settingsRes.data as Record<string, unknown> | null
  const botToken    = (settings?.discord_bot_token as string | null) ?? null
  const opsChannel  = ((settings?.discord_ops_channel_id as string | null) ?? process.env.DISCORD_OPS_CHANNEL_ID) ?? null
  const notifConfig = (settings?.notification_config as NotifConfig | null) ?? {}
  const notifyEmail = (settings?.notification_email as string | null) ?? null
  // Clamped, not just defaulted. `?? 14` only covers NULL, and the value that
  // actually causes damage is 0 — which makes every client stale on every run
  // AND defeats the re-arm window below (`now - 0` is always now), so the digest
  // names every client every weekday forever. The settings route now rejects it
  // on the way in; this defends against a row that already holds one.
  const rawAgencyDays = Number(settings?.contact_stale_days)
  const agencyName    = (settings?.agency_name as string | null) ?? 'Agency'
  const agencyDays    = Number.isFinite(rawAgencyDays) && rawAgencyDays >= 1
    ? Math.min(365, Math.trunc(rawAgencyDays))
    : 14

  const notif = getNotif(notifConfig, 'client_contact_stale')

  const clients = (clientsRes.data ?? []) as unknown as ClientRow[]
  const now     = Date.now()

  const stale: { row: ClientRow; days: number | null; threshold: number }[] = []

  for (const c of clients) {
    const perClient = Number(c.contact_stale_days)
    const threshold = Number.isFinite(perClient) && perClient >= 1
      ? Math.min(365, Math.trunc(perClient))
      : agencyDays
    const contacted = c.last_contacted_at ? new Date(c.last_contacted_at).getTime() : null
    const days      = contacted === null ? null : Math.floor((now - contacted) / DAY_MS)

    const isStale = days === null || days >= threshold
    if (!isStale) continue

    // Alert once per stale streak, then re-nudge no more often than the
    // threshold itself. Logging a contact clears last_contact_alert_at, which
    // re-arms this immediately.
    const alertedAt = c.last_contact_alert_at ? new Date(c.last_contact_alert_at).getTime() : null
    const rearmFrom = Math.max(contacted ?? 0, now - threshold * DAY_MS)
    if (alertedAt !== null && alertedAt >= rearmFrom) continue

    stale.push({ row: c, days, threshold })
  }

  if (stale.length === 0) {
    return NextResponse.json({ ok: true, checked: clients.length, stale: 0 })
  }

  stale.sort((a, b) => {
    const t = (TEMP_RANK[a.row.temperature ?? ''] ?? 3) - (TEMP_RANK[b.row.temperature ?? ''] ?? 3)
    if (t !== 0) return t
    return (b.days ?? Number.MAX_SAFE_INTEGER) - (a.days ?? Number.MAX_SAFE_INTEGER)
  })

  const lines = stale.map(({ row, days, threshold }) => {
    const temp = row.temperature ? ` \`${row.temperature}\`` : ''
    const age  = days === null ? 'never logged' : `${days}d ago`
    return `- **${row.name}**${temp} — ${age} (window ${threshold}d)`
  })

  const heading = `**Clients due a check-in** (${stale.length})`
  const body    = `${heading}\n${lines.join('\n')}`

  let discordSent = false
  if (notif.agency && botToken && opsChannel) {
    try {
      // Discord hard-caps a message at 2000 chars; chunk on line boundaries.
      for (const chunk of chunkLines(body, 1900)) {
        await sendDiscordMessage(botToken, opsChannel, chunk)
      }
      discordSent = true
    } catch (e) {
      console.error('[contact-staleness] discord send failed', e)
    }
  }

  let emailSent = false
  if (notif.email && notifyEmail) {
    try {
      await sendEmail({
        to:      notifyEmail,
        subject: `${stale.length} client${stale.length === 1 ? '' : 's'} due a check-in`,
        // Same shell as every other agency notification. This used to ship as a
        // bare <h2>/<ul> in the client's default serif, so the one email about
        // our own follow-up discipline was the one that looked like spam.
        html:    buildAgencyEmail(
          agencyName,
          'Clients due a check-in',
          `<ul style="margin:0;padding-left:18px;color:#374151;font-size:14px;line-height:1.7;">${
            stale.map(({ row, days, threshold }) =>
              `<li><strong>${escapeEmailHtml(row.name)}</strong>${row.temperature ? ` (${escapeEmailHtml(row.temperature)})` : ''} — ${
                days === null ? 'never logged' : `${days} days ago`
              }, window ${threshold}d</li>`).join('')
          }</ul>`,
        ),
      })
      emailSent = true
    } catch (e) {
      console.error('[contact-staleness] email send failed', e)
    }
  }

  // In-app alert so it is visible without Discord or email configured at all.
  const { error: alertErr } = await db.from('admin_alerts').insert({
    type:     'crm',
    severity: 'warning',
    title:    `${stale.length} client${stale.length === 1 ? '' : 's'} due a check-in`,
    body:     lines.join('\n'),
    link_url: '/admin/dashboard',
  })
  if (alertErr) console.error('[contact-staleness] admin_alerts insert failed', alertErr.message)
  const inAppSent = !alertErr

  // Only mark as alerted if the notice actually reached SOME channel, so a
  // Discord outage does not silently burn the one alert for this stale streak.
  // The in-app alert counts: without it, an agency with neither Discord nor
  // email configured would never stamp, and would re-insert the same digest
  // every single weekday.
  if (discordSent || emailSent || inAppSent) {
    const stamp = new Date().toISOString()
    const { error } = await db
      .from('clients')
      .update({ last_contact_alert_at: stamp })
      .in('id', stale.map(s => s.row.id))
    if (error) console.error('[contact-staleness] stamp failed', error.message)
  }

  return NextResponse.json({
    ok:      true,
    checked: clients.length,
    stale:   stale.length,
    discordSent,
    emailSent,
    inAppSent,
  })
}

/** Split a newline-delimited body into <= max-length chunks without cutting a line. */
function chunkLines(text: string, max: number): string[] {
  const out: string[] = []
  let buf = ''
  for (const line of text.split('\n')) {
    if (buf && buf.length + line.length + 1 > max) { out.push(buf); buf = line }
    else buf = buf ? `${buf}\n${line}` : line
  }
  if (buf) out.push(buf)
  return out
}

