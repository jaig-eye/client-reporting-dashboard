// GET /api/public/ads?token=...
// Public endpoint — validates dashboard_token, returns 30-day aggregated ad data.
// No session cookies required.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient }         from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export type MetaAdRow = {
  platform: 'meta'
  ad_id: string
  ad_name: string
  ad_status: string
  creative_title: string | null
  creative_body: string | null
  image_url: string | null
  thumbnail_url: string | null
  video_thumb_url: string | null
  adset_name: string
  campaign_name: string
  adset_daily_budget: number | null
  spend: number
  impressions: number
  clicks: number
  conversions: number
}

export type GoogleAdRow = {
  platform: 'google'
  ad_id: string
  ad_name: string
  ad_status: string
  ad_type: string | null
  headlines: string[]
  descriptions: string[]
  image_url: string | null
  ad_group_name: string
  campaign_name: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
}

export type AdsLibraryResponse = {
  client_name: string
  meta: MetaAdRow[]
  google: GoogleAdRow[]
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.json({ error: 'token required' }, { status: 401 })
  }

  const db = createAdminClient()

  const { data: client } = await db
    .from('clients')
    .select('id, name')
    .eq('dashboard_token', token)
    .maybeSingle()

  if (!client) {
    return NextResponse.json({ error: 'invalid token' }, { status: 401 })
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)

  const [{ data: metaRows }, { data: googleRows }] = await Promise.all([
    db
      .from('meta_ads_ad_metrics')
      .select('ad_id, ad_name, ad_status, creative_title, creative_body, image_url, thumbnail_url, video_thumb_url, adset_name, campaign_name, adset_daily_budget, spend, impressions, clicks, conversions')
      .eq('client_id', client.id)
      .gte('date', thirtyDaysAgo),
    db
      .from('google_ads_ad_metrics')
      .select('ad_id, ad_name, ad_status, ad_type, headlines, descriptions, image_url, ad_group_name, campaign_name, spend, impressions, clicks, conversions')
      .eq('client_id', client.id)
      .gte('date', thirtyDaysAgo),
  ])

  const metaMap = new Map<string, MetaAdRow>()
  for (const row of metaRows ?? []) {
    const e = metaMap.get(row.ad_id)
    if (e) {
      e.spend += Number(row.spend); e.impressions += row.impressions
      e.clicks += row.clicks; e.conversions += Number(row.conversions)
    } else {
      metaMap.set(row.ad_id, {
        platform:           'meta',
        ad_id:              row.ad_id,
        ad_name:            row.ad_name ?? '',
        ad_status:          row.ad_status ?? '',
        creative_title:     row.creative_title ?? null,
        creative_body:      row.creative_body ?? null,
        image_url:          row.image_url ?? null,
        thumbnail_url:      row.thumbnail_url ?? null,
        video_thumb_url:    row.video_thumb_url ?? null,
        adset_name:         row.adset_name ?? '',
        campaign_name:      row.campaign_name ?? '',
        adset_daily_budget: row.adset_daily_budget != null ? Number(row.adset_daily_budget) : null,
        spend:              Number(row.spend),
        impressions:        row.impressions,
        clicks:             row.clicks,
        conversions:        Number(row.conversions),
      })
    }
  }

  const googleMap = new Map<string, GoogleAdRow>()
  for (const row of googleRows ?? []) {
    const e = googleMap.get(row.ad_id)
    if (e) {
      e.spend += Number(row.spend); e.impressions += row.impressions
      e.clicks += row.clicks; e.conversions += Number(row.conversions)
    } else {
      googleMap.set(row.ad_id, {
        platform:       'google',
        ad_id:          row.ad_id,
        ad_name:        row.ad_name ?? '',
        ad_status:      row.ad_status ?? '',
        ad_type:        row.ad_type ?? null,
        headlines:      Array.isArray(row.headlines) ? (row.headlines as string[]) : [],
        descriptions:   Array.isArray(row.descriptions) ? (row.descriptions as string[]) : [],
        image_url:      row.image_url ?? null,
        ad_group_name:  row.ad_group_name ?? '',
        campaign_name:  row.campaign_name ?? '',
        spend:          Number(row.spend),
        impressions:    row.impressions,
        clicks:         row.clicks,
        conversions:    Number(row.conversions),
      })
    }
  }

  return NextResponse.json({
    client_name: client.name,
    meta:        Array.from(metaMap.values()),
    google:      Array.from(googleMap.values()),
  } satisfies AdsLibraryResponse)
}
