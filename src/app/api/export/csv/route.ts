import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { CampaignMetric } from '@/lib/types'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId = request.nextUrl.searchParams.get('clientId')
  const from = request.nextUrl.searchParams.get('from') || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const to = request.nextUrl.searchParams.get('to') || new Date().toISOString().split('T')[0]

  const db = createAdminClient()
  const { data } = await db
    .from('campaign_metrics')
    .select('*')
    .eq('client_id', clientId)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: false }) as { data: CampaignMetric[] | null }

  const rows = data || []
  const headers = ['date', 'platform', 'campaign_name', 'spend', 'impressions', 'clicks', 'conversions', 'conversion_value', 'roas', 'ctr', 'cpc', 'cpm']
  const csv = [
    headers.join(','),
    ...rows.map(r =>
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
