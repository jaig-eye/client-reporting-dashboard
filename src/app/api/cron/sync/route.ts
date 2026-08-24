import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { verifyCronAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { syncClient } from '@/lib/sync'
import { sendEmail } from '@/lib/email'
import { sendDiscordMessage } from '@/lib/discord'
import { getNotif, type NotifConfig } from '@/lib/notificationConfig'

export const maxDuration = 600

const ADS_TYPES    = ['google_ads', 'meta_ads']
const OTHER_TYPES  = ['google_analytics', 'google_business_profile', 'ghl', 'ahrefs', 'wordpress']

function shouldRunSync(
  freq: string,
  hourUtc: number,
  dayOfWeek: number | null,
  now: Date
): boolean {
  const h = now.getUTCHours()
  const d = now.getUTCDay()
  if (freq === 'hourly')   return true
  if (freq === 'every2h')  return h % 2 === 0
  if (freq === 'every6h')  return h % 6 === 0
  if (freq === 'every12h') return h % 12 === 0
  if (freq === 'daily')    return h === hourUtc
  if (freq === 'weekly')   return d === (dayOfWeek ?? 1) && h === hourUtc
  return h === hourUtc
}

// Called hourly by Vercel Cron (vercel.json). shouldRunSync gates each connector type per agency settings.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!verifyCronAuth(authHeader)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  const { data: settings } = await db
    .from('agency_settings')
    .select('cron_enabled, sync_frequency, sync_hour_utc, sync_day_of_week, ads_sync_frequency, ads_sync_hour_utc, notify_connector_errors, notification_email, agency_name, discord_bot_token, discord_ops_channel_id, notification_config')
    .single()

  if (settings?.cron_enabled === false) {
    return NextResponse.json({ skipped: true, reason: 'Cron sync disabled in Agency Settings' })
  }

  const now = new Date()

  // Ads connectors — separate (hourly by default) schedule
  const adsFreq    = (settings?.ads_sync_frequency as string) ?? 'hourly'
  const adsHour    = (settings?.ads_sync_hour_utc  as number) ?? 0
  const runAds     = shouldRunSync(adsFreq, adsHour, null, now)

  // Other connectors — existing schedule
  const otherFreq  = (settings?.sync_frequency   as string)      ?? 'daily'
  const otherHour  = (settings?.sync_hour_utc    as number)      ?? 6
  const otherDay   = (settings?.sync_day_of_week as number|null) ?? null
  const runOther   = shouldRunSync(otherFreq, otherHour, otherDay, now)

  if (!runAds && !runOther) {
    return NextResponse.json({ skipped: true, reason: 'Not scheduled to run' })
  }

  const { data: clients } = await db.from('clients').select('id, name')

  const agencyName     = (settings as Record<string, unknown>).agency_name as string | undefined
  const discordToken   = (settings as Record<string, unknown>).discord_bot_token as string | null | undefined
  const opsChannelId   = (settings as Record<string, unknown>).discord_ops_channel_id as string | null | undefined
  const notifConfig    = ((settings as Record<string, unknown>).notification_config as NotifConfig | null) ?? {}
  const connectionsUrl = `${process.env.NEXT_PUBLIC_APP_URL}/admin/connections`

  const settled = await Promise.allSettled(
    (clients ?? []).map(async (client) => {
      let records = 0
      if (runAds) {
        records += await syncClient(client.id, 'incremental', undefined, undefined, undefined, undefined, 'cron', false, ADS_TYPES)
      }
      if (runOther) {
        records += await syncClient(client.id, 'incremental', undefined, undefined, undefined, undefined, 'cron', false, OTHER_TYPES)
      }
      return { client: client.name, status: 'success' as const, records }
    })
  )

  const results = await Promise.all(
    settled.map(async (r, i) => {
      if (r.status === 'fulfilled') return r.value
      const client = (clients ?? [])[i]
      const errStr = String(r.reason)
      const isAuthError = /OAuthException|access.?token|session.?(expired|invalidat)|code[: ]*190/i.test(errStr)

      if (isAuthError) {
        console.warn(`[sync cron] Auth error for ${client.name}:`, errStr.slice(0, 300))

        // Dedup: only alert once per client per 24 hours
        const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        const { data: existingAlert } = await db
          .from('admin_alerts')
          .select('id')
          .eq('type', 'integration')
          .eq('client_id', client.id)
          .gte('created_at', since24h)
          .limit(1)
          .maybeSingle()

        if (!existingAlert) {
          // Record the alert so we don't spam
          await db.from('admin_alerts').insert({
            type:        'integration',
            severity:    'critical',
            client_id:   client.id,
            title:       `Connector auth error — ${client.name}`,
            body:        errStr.slice(0, 500),
            link_url:    connectionsUrl,
          }).then(null, () => {})

          // Discord alert
          if (discordToken && opsChannelId && getNotif(notifConfig, 'sync_connector_error').agency) {
            const msg = `🔑 **Connector auth error — ${client.name}**\nAn integration token has expired or been revoked. Syncing is paused until reconnected.\n→ ${connectionsUrl}`
            void sendDiscordMessage(discordToken, opsChannelId, msg).catch(() => {})
          }

          // Email alert
          if (getNotif(notifConfig, 'sync_connector_error').email && settings?.notification_email) {
            try {
              await sendEmail({
                to:      String(settings.notification_email),
                subject: `[${agencyName ?? 'Agency'}] Connector auth error — ${client.name}`,
                html:    `<p>A sync for <strong>${client.name}</strong> failed due to an authentication error.</p>
                          <p style="font-family:monospace;background:#f1f5f9;padding:8px;border-radius:4px;font-size:13px">${errStr.slice(0, 600)}</p>
                          <p><a href="${connectionsUrl}">Reconnect the expired integration →</a></p>`,
              })
            } catch (emailErr) {
              console.warn('[sync cron] Failed to send connector error email:', emailErr)
            }
          }
        }
      }

      return { client: client.name, status: 'error' as const, error: errStr }
    })
  )

  // Bust the dashboard data cache for every client that synced so the next page
  // visit re-fetches fresh metrics instead of serving the 5-minute stale copy.
  revalidateTag('client-metrics')

  return NextResponse.json({ synced: results.length, adsRan: runAds, otherRan: runOther, results })
}
