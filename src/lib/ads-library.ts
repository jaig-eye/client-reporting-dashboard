// Shared types and server-side data-fetching for the Ad Library feature.
// Imported by /api/public/ads (external API) and /share/ads (SSR page).
// DO NOT import this file from client components — use `import type` for types only.

import { createAdminClient } from '@/lib/supabase/server'

type DbClient = ReturnType<typeof createAdminClient>

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

/**
 * Fetches and aggregates the last 30 days of Meta + Google ads for a client.
 *
 * - Excludes DELETED and REMOVED ads from both platforms.
 * - Orders rows by date DESC so the most recent adset_daily_budget is captured
 *   when the first row for each ad_id seeds the Map entry.
 * - All numeric columns are coerced with Number() for safety against Postgres
 *   types that PostgREST might serialize as strings (NUMERIC, BIGINT).
 */
export async function fetchClientAds(
  db: DbClient,
  clientId: string,
): Promise<{ meta: MetaAdRow[]; google: GoogleAdRow[]; error?: string }> {
  // 90-day window for creative/status accuracy — the most recent row (date DESC)
  // seeds status/image/title regardless of age. Metrics are only accumulated from
  // rows within the last 30 days. Ads with no 30-day activity are filtered out.
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)

  const [metaRes, googleRes] = await Promise.all([
    db
      .from('meta_ads_ad_metrics')
      .select('ad_id, ad_name, ad_status, creative_title, creative_body, image_url, thumbnail_url, video_thumb_url, adset_name, campaign_name, adset_daily_budget, spend, impressions, clicks, conversions, date')
      .eq('client_id', clientId)
      .gte('date', ninetyDaysAgo)
      .not('ad_status', 'in', '("DELETED","REMOVED")')
      .order('date', { ascending: false }),
    db
      .from('google_ads_ad_metrics')
      .select('ad_id, ad_name, ad_status, ad_type, headlines, descriptions, image_url, ad_group_name, campaign_name, spend, impressions, clicks, conversions, date')
      .eq('client_id', clientId)
      .gte('date', ninetyDaysAgo)
      .not('ad_status', 'in', '("DELETED","REMOVED")')
      .in('ad_type', ['RESPONSIVE_DISPLAY_AD', 'DEMAND_GEN_MULTI_ASSET_AD', 'DEMAND_GEN_VIDEO_RESPONSIVE_AD', 'ASSET_GROUP'])
      .order('date', { ascending: false }),
  ])

  if (metaRes.error)   return { meta: [], google: [], error: `meta_ads: ${metaRes.error.message}` }
  if (googleRes.error) return { meta: [], google: [], error: `google_ads: ${googleRes.error.message}` }

  // Aggregate per ad_id. Rows are ordered DESC so the first row seen is the
  // most recent — creative/status fields (image, title, ad_status) are seeded
  // from that row regardless of date. Metrics are only accumulated for rows
  // within the last 30 days. Ads with no 30-day activity are excluded via the
  // metaRecent / googleRecent sets.
  const metaMap    = new Map<string, MetaAdRow>()
  const metaRecent = new Set<string>()
  for (const row of metaRes.data ?? []) {
    const inWindow = row.date >= thirtyDaysAgo
    if (inWindow) metaRecent.add(row.ad_id)

    const e = metaMap.get(row.ad_id)
    if (e) {
      if (inWindow) {
        e.spend       += Number(row.spend)
        e.impressions += Number(row.impressions)
        e.clicks      += Number(row.clicks)
        e.conversions += Number(row.conversions)
      }
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
        spend:              inWindow ? Number(row.spend)       : 0,
        impressions:        inWindow ? Number(row.impressions) : 0,
        clicks:             inWindow ? Number(row.clicks)      : 0,
        conversions:        inWindow ? Number(row.conversions) : 0,
      })
    }
  }

  const googleMap    = new Map<string, GoogleAdRow>()
  const googleRecent = new Set<string>()
  for (const row of googleRes.data ?? []) {
    const inWindow = row.date >= thirtyDaysAgo
    if (inWindow) googleRecent.add(row.ad_id)

    const e = googleMap.get(row.ad_id)
    if (e) {
      if (inWindow) {
        e.spend       += Number(row.spend)
        e.impressions += Number(row.impressions)
        e.clicks      += Number(row.clicks)
        e.conversions += Number(row.conversions)
      }
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
        spend:          inWindow ? Number(row.spend)       : 0,
        impressions:    inWindow ? Number(row.impressions) : 0,
        clicks:         inWindow ? Number(row.clicks)      : 0,
        conversions:    inWindow ? Number(row.conversions) : 0,
      })
    }
  }

  // For PMax (ASSET_GROUP) ads without a stored image_url, pull the first
  // MARKETING_IMAGE from google_ads_asset_group_assets. The asset_group_id
  // matches ad_id in the metrics table.
  const pmaxIds = Array.from(googleMap.keys()).filter(
    id => googleMap.get(id)?.ad_type === 'ASSET_GROUP',
  )
  if (pmaxIds.length > 0) {
    const { data: pmaxAssets } = await db
      .from('google_ads_asset_group_assets')
      .select('asset_group_id, image_url')
      .in('asset_group_id', pmaxIds)
      .eq('field_type', 'MARKETING_IMAGE')
      .not('image_url', 'is', null)
    for (const asset of pmaxAssets ?? []) {
      const entry = googleMap.get(asset.asset_group_id as string)
      if (entry && !entry.image_url) entry.image_url = asset.image_url as string
    }
  }

  return {
    meta:   Array.from(metaMap.values()).filter(a => metaRecent.has(a.ad_id)),
    google: Array.from(googleMap.values()).filter(a => googleRecent.has(a.ad_id)),
  }
}
