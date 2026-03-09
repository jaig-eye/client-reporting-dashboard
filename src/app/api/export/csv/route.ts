import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import type { GoogleAdsMetric, MetaAdsMetric } from '@/lib/types'
import type { MetaAction } from '@/lib/connectors/types'

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  const clientToken = cookieStore.get('client_token')?.value
  if (!clientToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('dashboard_token', clientToken)
    .single()

  if (!client) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const from = request.nextUrl.searchParams.get('from') || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const to   = request.nextUrl.searchParams.get('to')   || new Date().toISOString().split('T')[0]

  // Fetch from both source tables in parallel
  const [googleRes, metaRes] = await Promise.all([
    db.from('google_ads_metrics')
      .select('date, campaign_name, spend, impressions, clicks, conversions, conversions_value, roas, ctr, cpc, cpm')
      .eq('client_id', client.id)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false }),
    db.from('meta_ads_metrics')
      .select('date, campaign_name, spend, impressions, clicks, conversions, conversion_value, roas, ctr, cpc, cpm, actions, action_values')
      .eq('client_id', client.id)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false }),
  ])

  const headers = ['date', 'source', 'campaign_name', 'spend', 'impressions', 'clicks', 'conversions', 'conversion_value', 'roas', 'ctr', 'cpc', 'cpm']

  const googleRows = ((googleRes.data ?? []) as GoogleAdsMetric[]).map(r => [
    r.date, 'Google Ads', escapeCSV(r.campaign_name), r.spend.toFixed(2),
    r.impressions, r.clicks, r.conversions.toFixed(2), r.conversions_value.toFixed(2),
    r.roas.toFixed(4), r.ctr.toFixed(4), r.cpc.toFixed(2), r.cpm.toFixed(2),
  ])

  const metaRows = ((metaRes.data ?? []) as MetaAdsMetric[]).map(r => [
    r.date, 'Meta Ads', escapeCSV(r.campaign_name), r.spend.toFixed(2),
    r.impressions, r.clicks, r.conversions.toFixed(2), r.conversion_value.toFixed(2),
    r.roas.toFixed(4), r.ctr.toFixed(4), r.cpc.toFixed(2), r.cpm.toFixed(2),
  ])

  const csv = [
    headers.join(','),
    ...[...googleRows, ...metaRows].map(row => row.join(',')),
  ].join('\n')

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="report-${from}-${to}.csv"`,
    },
  })
}

function escapeCSV(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}
