import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import type { CampaignMetric, MetricConfig } from '@/lib/types'

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  const clientToken = cookieStore.get('client_token')?.value
  if (!clientToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  // Fetch client + agency settings in parallel for metric config resolution
  const [{ data: client }, { data: agencyRow }] = await Promise.all([
    db.from('clients').select('id, metric_config').eq('dashboard_token', clientToken).single(),
    db.from('agency_settings').select('metric_config').single(),
  ])

  if (!client) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Effective metric config: client overrides global
  const effectiveConfig: MetricConfig = {
    ...(agencyRow?.metric_config as MetricConfig ?? {}),
    ...(client.metric_config as MetricConfig ?? {}),
  }
  const metaConversionAction = effectiveConfig.meta_conversion_action

  const from = request.nextUrl.searchParams.get('from') || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const to   = request.nextUrl.searchParams.get('to')   || new Date().toISOString().split('T')[0]

  const { data } = await db
    .from('campaign_metrics')
    .select('*')
    .eq('client_id', client.id)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: false }) as { data: CampaignMetric[] | null }

  const rows = data || []

  // Apply the same live remapping logic as the dashboard so the export
  // reflects the current metric mapping, not the stale sync-time value.
  const remapped = rows.map(row => {
    if (
      row.platform !== 'meta' ||
      !metaConversionAction ||
      metaConversionAction === 'results' ||
      !row.raw_meta_actions?.length
    ) return row

    const conversions = row.raw_meta_actions
      .filter(a => a.action_type === metaConversionAction)
      .reduce((s, a) => s + parseFloat(a.value || '0'), 0)
    return { ...row, conversions }
  })

  const headers = ['date', 'platform', 'campaign_name', 'spend', 'impressions', 'clicks', 'conversions', 'conversion_value', 'roas', 'ctr', 'cpc', 'cpm']
  const csv = [
    headers.join(','),
    ...remapped.map(r =>
      headers.map(h => {
        const val = r[h as keyof CampaignMetric]
        return typeof val === 'string' && val.includes(',') ? `"${val}"` : val
      }).join(',')
    ),
  ].join('\n')

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="report-${from}-${to}.csv"`,
    },
  })
}
