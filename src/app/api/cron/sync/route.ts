import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { syncClient } from '@/lib/sync'

export const maxDuration = 300

const ADS_TYPES    = ['google_ads', 'meta_ads']
const OTHER_TYPES  = ['google_analytics', 'google_search_console', 'google_business_profile', 'ghl', 'ahrefs', 'wordpress']

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
  return h === hourUtc
}

// Called hourly by Vercel Cron (vercel.json). Applies shouldRunSync gating per schedule.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  const { data: settings } = await db
    .from('agency_settings')
    .select('cron_enabled, sync_frequency, sync_hour_utc, sync_day_of_week, ads_sync_frequency, ads_sync_hour_utc')
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
  const results = []

  for (const client of clients ?? []) {
    let records = 0
    try {
      if (runAds) {
        records += await syncClient(client.id, 'incremental', undefined, undefined, undefined, undefined, 'cron', false, ADS_TYPES)
      }
      if (runOther) {
        records += await syncClient(client.id, 'incremental', undefined, undefined, undefined, undefined, 'cron', false, OTHER_TYPES)
      }
      results.push({ client: client.name, status: 'success', records })
    } catch (e) {
      results.push({ client: client.name, status: 'error', error: String(e) })
    }
  }

  return NextResponse.json({ synced: results.length, adsRan: runAds, otherRan: runOther, results })
}
