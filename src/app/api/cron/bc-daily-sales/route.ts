import { NextRequest, NextResponse } from 'next/server'
import { timingSafeCompare } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { fetchBCOrders, fetchBCStoreTimezone } from '@/lib/connectors/bigcommerce'
import { sendDiscordMessage } from '@/lib/discord'
import { getNotif, type NotifConfig } from '@/lib/notificationConfig'

export const maxDuration = 60

function fmt$(amount: number): string {
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

// ── Timezone helpers (no external library — pure Intl) ─────────────────────

function tzOffsetMs(tzName: string, sampleUtc: Date): number {
  // Returns (UTC ms) - (local ms); positive for timezones behind UTC (e.g. US)
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tzName,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
  })
  const p = f.formatToParts(sampleUtc).reduce<Record<string, string>>(
    (acc, { type, value }) => { acc[type] = value; return acc }, {}
  )
  const h = parseInt(p.hour)
  const localMs = Date.UTC(
    parseInt(p.year), parseInt(p.month) - 1, parseInt(p.day),
    h === 24 ? 0 : h, parseInt(p.minute), parseInt(p.second),
  )
  return sampleUtc.getTime() - localMs
}

// Returns the UTC Date that equals midnight of (now + dayOffset days) in tzName.
// Samples the offset at noon of the target day to avoid DST-transition edge cases.
function localMidnight(tzName: string, now: Date, dayOffset: number): Date {
  const shifted = new Date(now.getTime() + dayOffset * 86_400_000)
  const dp = new Intl.DateTimeFormat('en-US', {
    timeZone: tzName, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(shifted).reduce<Record<string, string>>(
    (acc, { type, value }) => { acc[type] = value; return acc }, {}
  )
  const y = parseInt(dp.year), m = parseInt(dp.month) - 1, d = parseInt(dp.day)
  const offsetMs = tzOffsetMs(tzName, new Date(Date.UTC(y, m, d, 12)))
  return new Date(Date.UTC(y, m, d, 0, 0, 0) + offsetMs)
}

// Returns the UTC Date that equals the first of the current local month at midnight.
function localMonthStart(tzName: string, now: Date): Date {
  const dp = new Intl.DateTimeFormat('en-US', {
    timeZone: tzName, year: 'numeric', month: '2-digit',
  }).formatToParts(now).reduce<Record<string, string>>(
    (acc, { type, value }) => { acc[type] = value; return acc }, {}
  )
  const y = parseInt(dp.year), m = parseInt(dp.month) - 1
  const offsetMs = tzOffsetMs(tzName, new Date(Date.UTC(y, m, 1, 12)))
  return new Date(Date.UTC(y, m, 1, 0, 0, 0) + offsetMs)
}

// ── Cron handler ───────────────────────────────────────────────────────────

// Called daily at 09:00 UTC by Vercel Cron.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!timingSafeCompare(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  const { data: agencySettings } = await db
    .from('agency_settings')
    .select('discord_bot_token, notification_config')
    .single()

  const botToken    = (agencySettings as Record<string, unknown> | null)?.discord_bot_token as string | null
  const notifConfig = ((agencySettings as Record<string, unknown> | null)?.notification_config as NotifConfig | null) ?? {}
  if (!botToken) {
    return NextResponse.json({ skipped: true, reason: 'No Discord bot token configured' })
  }

  const { data: clients } = await db
    .from('clients')
    .select('id, name, discord_channel_id, bc_daily_report')
    .eq('bc_daily_report', true)
    .not('discord_channel_id', 'is', null)

  if (!clients?.length) {
    return NextResponse.json({ skipped: true, reason: 'No clients with bc_daily_report enabled' })
  }

  const now     = new Date()
  const results = []

  for (const client of clients) {
    const channelId = client.discord_channel_id as string

    const { data: connections } = await db
      .from('client_connections')
      .select('id, connector:connectors(id, type, config, status)')
      .eq('client_id', client.id)

    type ConnRow = { id: string; type: string; config: Record<string, unknown> | null; status: string }
    const bcConns = (connections ?? [])
      .filter((c) => (c.connector as unknown as ConnRow | null)?.type === 'bigcommerce')
      .map((c) => ({ id: c.id, connector: c.connector as unknown as ConnRow }))

    if (!bcConns.length) {
      results.push({ client: client.name, status: 'skipped', reason: 'No BC connection' })
      continue
    }

    // Prefer analytics role; fall back to any BC connection
    const sorted = [...bcConns].sort((a, b) => {
      const aRole = a.connector.config?.role
      const bRole = b.connector.config?.role
      return aRole === 'analytics' ? -1 : bRole === 'analytics' ? 1 : 0
    })

    let summary: { grossRevenue: number; orderCount: number } | null = null
    let mtd: { grossRevenue: number; orderCount: number } | null = null
    let dateLabel = now.toISOString().slice(0, 10)
    let lastError: string | null = null

    for (const conn of sorted) {
      const cfg         = conn.connector.config ?? {}
      const storeHash   = String(cfg.store_hash  || '')
      const accessToken = String(cfg.access_token || '')
      if (!storeHash || !accessToken) continue

      try {
        // Fetch the store's IANA timezone so date boundaries align with local midnight,
        // not UTC midnight — avoids systematically missing late-evening orders.
        const storeTz = await fetchBCStoreTimezone(storeHash, accessToken) ?? 'UTC'

        const yesterdayStart = localMidnight(storeTz, now, -1)
        const yesterdayEnd   = new Date(localMidnight(storeTz, now, 0).getTime() - 1)
        const mtdStart       = localMonthStart(storeTz, now)

        dateLabel = new Intl.DateTimeFormat('en-CA', { timeZone: storeTz }).format(yesterdayStart)

        const [yday, mtdData] = await Promise.all([
          fetchBCOrders(storeHash, accessToken, yesterdayStart, yesterdayEnd),
          fetchBCOrders(storeHash, accessToken, mtdStart, yesterdayEnd),
        ])
        summary = yday
        mtd     = mtdData
        break
      } catch (err) {
        lastError = String(err)
      }
    }

    if (!summary || !mtd) {
      results.push({ client: client.name, status: 'error', error: lastError ?? 'All BC connections failed' })
      continue
    }

    const message = [
      `📊 **${client.name} Daily Sales Update ${dateLabel}**`,
      `Yesterday Sales (Gross): ${fmt$(summary.grossRevenue)}`,
      `MTD Sales (Gross): ${fmt$(mtd.grossRevenue)}`,
    ].join('\n')

    try {
      if (getNotif(notifConfig, 'bc_daily_sales').client) await sendDiscordMessage(botToken, channelId, message)
      results.push({ client: client.name, status: 'sent', yesterday: summary.grossRevenue, mtd: mtd.grossRevenue })
    } catch (err) {
      results.push({ client: client.name, status: 'discord_error', error: String(err) })
    }
  }

  return NextResponse.json({ sent: results.length, results })
}
