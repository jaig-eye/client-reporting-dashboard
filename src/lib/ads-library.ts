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
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)

  const [metaRes, googleRes] = await Promise.all([
    db
      .from('meta_ads_ad_metrics')
      .select('ad_id, ad_name, ad_status, creative_title, creative_body, image_url, thumbnail_url, video_thumb_url, adset_name, campaign_name, adset_daily_budget, spend, impressions, clicks, conversions')
      .eq('client_id', clientId)
      .gte('date', thirtyDaysAgo)
      .not('ad_status', 'in', '("DELETED","REMOVED")')
      .order('date', { ascending: false }),
    db
      .from('google_ads_ad_metrics')
      .select('ad_id, ad_name, ad_status, ad_type, headlines, descriptions, image_url, ad_group_name, campaign_name, spend, impressions, clicks, conversions')
      .eq('client_id', clientId)
      .gte('date', thirtyDaysAgo)
      .not('ad_status', 'in', '("DELETED","REMOVED")')
      .order('date', { ascending: false }),
  ])

  if (metaRes.error)   return { meta: [], google: [], error: `meta_ads: ${metaRes.error.message}` }
  if (googleRes.error) return { meta: [], google: [], error: `google_ads: ${googleRes.error.message}` }

  // Aggregate per ad_id. Rows are ordered DESC so the first row seen is the
  // most recent — this ensures adset_daily_budget reflects the current budget.
  const metaMap = new Map<string, MetaAdRow>()
  for (const row of metaRes.data ?? []) {
    const e = metaMap.get(row.ad_id)
    if (e) {
      e.spend       += Number(row.spend)
      e.impressions += Number(row.impressions)
      e.clicks      += Number(row.clicks)
      e.conversions += Number(row.conversions)
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
        impressions:        Number(row.impressions),
        clicks:             Number(row.clicks),
        conversions:        Number(row.conversions),
      })
    }
  }

  const googleMap = new Map<string, GoogleAdRow>()
  for (const row of googleRes.data ?? []) {
    const e = googleMap.get(row.ad_id)
    if (e) {
      e.spend       += Number(row.spend)
      e.impressions += Number(row.impressions)
      e.clicks      += Number(row.clicks)
      e.conversions += Number(row.conversions)
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
        impressions:    Number(row.impressions),
        clicks:         Number(row.clicks),
        conversions:    Number(row.conversions),
      })
    }
  }

  return {
    meta:   Array.from(metaMap.values()),
    google: Array.from(googleMap.values()),
  }
}
