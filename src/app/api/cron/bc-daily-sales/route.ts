import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { fetchBCOrders } from '@/lib/connectors/bigcommerce'
import { sendDiscordMessage } from '@/lib/discord'

export const maxDuration = 60

function fmt$(amount: number): string {
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function toUTCDay(d: Date, offsetDays: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offsetDays))
}

// Called daily at 09:00 UTC by Vercel Cron.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  const { data: agencySettings } = await db
    .from('agency_settings')
    .select('discord_bot_token')
    .single()

  const botToken = (agencySettings as Record<string, unknown> | null)?.discord_bot_token as string | null
  if (!botToken) {
    return NextResponse.json({ skipped: true, reason: 'No Discord bot token configured' })
  }

  // Fetch clients opted into daily BC report with a Discord channel
  const { data: clients } = await db
    .from('clients')
    .select('id, name, discord_channel_id, bc_daily_report')
    .eq('bc_daily_report', true)
    .not('discord_channel_id', 'is', null)

  if (!clients?.length) {
    return NextResponse.json({ skipped: true, reason: 'No clients with bc_daily_report enabled' })
  }

  // Date anchors (UTC)
  const now         = new Date()
  const todayStart  = toUTCDay(now, 0)
  const yesterdayStart = toUTCDay(now, -1)
  const yesterdayEnd   = new Date(todayStart.getTime() - 1)          // 23:59:59.999 yesterday
  const monthStart     = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const dateLabel      = yesterdayStart.toISOString().slice(0, 10)   // YYYY-MM-DD

  const results = []

  for (const client of clients) {
    const channelId = client.discord_channel_id as string

    // Fetch all connections for this client, filter to BC in JS
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
    let lastError: string | null = null

    for (const conn of sorted) {
      const cfg         = conn.connector.config ?? {}
      const storeHash   = String(cfg.store_hash  || '')
      const accessToken = String(cfg.access_token || '')
      if (!storeHash || !accessToken) continue

      try {
        const [yday, mtdData] = await Promise.all([
          fetchBCOrders(storeHash, accessToken, yesterdayStart, yesterdayEnd),
          fetchBCOrders(storeHash, accessToken, monthStart, yesterdayEnd),
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
      await sendDiscordMessage(botToken, channelId, message)
      results.push({ client: client.name, status: 'sent', yesterday: summary.grossRevenue, mtd: mtd.grossRevenue })
    } catch (err) {
      results.push({ client: client.name, status: 'discord_error', error: String(err) })
    }
  }

  return NextResponse.json({ sent: results.length, results })
}
