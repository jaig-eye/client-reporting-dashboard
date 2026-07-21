import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import type { GoogleAdsMetric } from '@/lib/types'
import type { MetaAction } from '@/lib/types'
import { resolveMetaConversions } from '@/lib/metrics'

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  const clientToken = cookieStore.get('client_token')?.value
  if (!clientToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  const { data: client } = await db
    .from('clients')
    .select('id, purchase_action, purchase_action_fallback, lead_action, lead_action_fallback')
    .eq('dashboard_token', clientToken)
    .maybeSingle()

  if (!client) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const from = request.nextUrl.searchParams.get('from') || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const to   = request.nextUrl.searchParams.get('to')   || new Date().toISOString().split('T')[0]

  // Fetch Google campaign-level and Meta ad-level in parallel.
  // Meta: use meta_ads_ad_metrics (ad-level) per CLAUDE.md — never aggregate from
  // meta_ads_metrics (campaign-level) for totals; ad-level data is the source of truth.
  const [googleRes, metaRes] = await Promise.all([
    db.from('google_ads_metrics')
      .select('date, campaign_name, spend, impressions, clicks, conversions, conversions_value, roas, ctr, cpc, cpm')
      .eq('client_id', client.id)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false }),
    db.from('meta_ads_ad_metrics')
      .select('date, campaign_id, campaign_name, spend, impressions, clicks, actions, action_values')
      .eq('client_id', client.id)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false }),
  ])

  // Aggregate Meta ad-level rows by (date, campaign_id) so the CSV shows one row per
  // campaign per day, matching the Google Ads format.  Merge actions/action_values arrays
  // by summing matching action_type values before resolving conversions.
  type MetaAdRow = {
    date: string
    campaign_id: string
    campaign_name: string
    spend: number
    impressions: number
    clicks: number
    actions: MetaAction[] | null
    action_values: MetaAction[] | null
  }

  type AggRow = {
    date: string
    campaign_name: string
    spend: number
    impressions: number
    clicks: number
    actions: MetaAction[]
    action_values: MetaAction[]
  }

  const metaAgg = new Map<string, AggRow>()

  for (const r of (metaRes.data ?? []) as MetaAdRow[]) {
    const key = `${r.date}_${r.campaign_id}`
    const ex  = metaAgg.get(key)
    if (ex) {
      ex.spend       += Number(r.spend)       || 0
      ex.impressions += Number(r.impressions) || 0
      ex.clicks      += Number(r.clicks)      || 0
      // Merge action arrays by action_type, summing numeric values
      for (const a of (r.actions ?? [])) {
        const found = ex.actions.find(x => x.action_type === a.action_type)
        if (found) {
          found.value = String(parseFloat(found.value || '0') + parseFloat(a.value || '0'))
        } else {
          ex.actions.push({ ...a })
        }
      }
      for (const a of (r.action_values ?? [])) {
        const found = ex.action_values.find(x => x.action_type === a.action_type)
        if (found) {
          found.value = String(parseFloat(found.value || '0') + parseFloat(a.value || '0'))
        } else {
          ex.action_values.push({ ...a })
        }
      }
    } else {
      metaAgg.set(key, {
        date:          r.date,
        campaign_name: r.campaign_name || '',
        spend:         Number(r.spend)       || 0,
        impressions:   Number(r.impressions) || 0,
        clicks:        Number(r.clicks)      || 0,
        actions:       (r.actions      ?? []).map(a => ({ ...a })),
        action_values: (r.action_values ?? []).map(a => ({ ...a })),
      })
    }
  }

  // Resolve Meta conversions using the client's configured action types, falling back to
  // sensible defaults. resolveMetaConversions tries primary → fallback → omni_purchase.
  const primaryAction  = (client as Record<string, unknown>).purchase_action  as string | null ?? 'purchase'
  const fallbackAction = (client as Record<string, unknown>).lead_action       as string | null ?? 'lead'

  const headers = ['date', 'source', 'campaign_name', 'spend', 'impressions', 'clicks', 'conversions', 'conversion_value', 'roas', 'ctr', 'cpc', 'cpm']

  const googleRows = ((googleRes.data ?? []) as GoogleAdsMetric[]).map(r => [
    r.date, 'Google Ads', escapeCSV(r.campaign_name), r.spend.toFixed(2),
    r.impressions, r.clicks, r.conversions.toFixed(2), r.conversions_value.toFixed(2),
    r.roas.toFixed(4), r.ctr.toFixed(4), r.cpc.toFixed(2), r.cpm.toFixed(2),
  ])

  const metaRows = Array.from(metaAgg.values())
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(r => {
      const { conversions, conversionValue } = resolveMetaConversions(
        r.actions, r.action_values, primaryAction, fallbackAction,
      )
      const roas = r.spend > 0 && conversionValue > 0 ? conversionValue / r.spend : 0
      const ctr  = r.impressions > 0 ? r.clicks / r.impressions : 0
      const cpc  = r.clicks > 0 ? r.spend / r.clicks : 0
      const cpm  = r.impressions > 0 ? (r.spend / r.impressions) * 1000 : 0
      return [
        r.date, 'Meta Ads', escapeCSV(r.campaign_name), r.spend.toFixed(2),
        r.impressions, r.clicks, conversions.toFixed(2), conversionValue.toFixed(2),
        roas.toFixed(4), ctr.toFixed(4), cpc.toFixed(2), cpm.toFixed(2),
      ]
    })

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
