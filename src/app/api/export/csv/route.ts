import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import type { CampaignMetric } from '@/lib/types'

export async function GET(request: NextRequest) {
  // Allow access via client token cookie
  const cookieStore = await cookies()
  const clientToken = cookieStore.get('client_token')?.value
  if (!clientToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  // Verify token and get client
  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('dashboard_token', clientToken)
    .single()

  if (!client) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const from = request.nextUrl.searchParams.get('from') || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const to = request.nextUrl.searchParams.get('to') || new Date().toISOString().split('T')[0]

  const { data } = await db
    .from('campaign_metrics')
    .select('*')
    .eq('client_id', client.id)
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
