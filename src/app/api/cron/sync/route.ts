import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { syncClient } from '@/lib/sync'

export const maxDuration = 300

function shouldRunSync(
  freq: string,
  hourUtc: number,
  dayOfWeek: number | null,
  now: Date
): boolean {
  const h = now.getUTCHours()
  const d = now.getUTCDay()
  if (freq === 'hourly')   return true
  if (freq === 'every6h')  return h % 6 === 0
  if (freq === 'every12h') return h % 12 === 0
  if (freq === 'daily')    return h === hourUtc
  if (freq === 'weekly')   return d === (dayOfWeek ?? 1) && h === hourUtc
  return h === hourUtc // fallback: daily behaviour
}

// Called hourly by Vercel Cron (vercel.json). Applies shouldRunSync gating.
export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  // Check if cron sync is enabled in agency settings + read schedule
  const { data: settings } = await db
    .from('agency_settings')
    .select('cron_enabled, sync_frequency, sync_hour_utc, sync_day_of_week')
    .single()
  if (settings?.cron_enabled === false) {
    return NextResponse.json({ skipped: true, reason: 'Cron sync disabled in Agency Settings' })
  }

  const freq       = (settings?.sync_frequency  as string)  ?? 'daily'
  const hourUtc    = (settings?.sync_hour_utc   as number)  ?? 6
  const dayOfWeek  = (settings?.sync_day_of_week as number | null) ?? null

  if (!shouldRunSync(freq, hourUtc, dayOfWeek, new Date())) {
    return NextResponse.json({ skipped: true, reason: `Not scheduled to run (${freq})` })
  }

  const { data: clients } = await db.from('clients').select('id, name')

  const results = []
  for (const client of clients || []) {
    try {
      const count = await syncClient(client.id, 'incremental', undefined, undefined, undefined, undefined, 'cron')
      results.push({ client: client.name, status: 'success', records: count })
    } catch (e) {
      results.push({ client: client.name, status: 'error', error: String(e) })
    }
  }

  return NextResponse.json({ synced: results.length, results })
}
