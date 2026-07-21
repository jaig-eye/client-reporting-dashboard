// Shared types and server-side data-fetching for the Ad Library feature.
// Imported by /api/public/ads (external API) and /share/ads (SSR page).
// DO NOT import this file from client components — use `import type` for types only.

import { createAdminClient } from '@/lib/supabase/server'

type DbClient = ReturnType<typeof createAdminClient>

const META_API_VERSION = 'v21.0'
const META_BASE_URL    = `https://graph.facebook.com/${META_API_VERSION}`

/**
 * For Meta ads that have no stored image_url, fetches a fresh image from the
 * Meta Graph API using the client's stored access token, then writes it back
 * to the DB so subsequent loads are instant.
 */
async function enrichMetaImages(db: DbClient, clientId: string, ads: MetaAdRow[]): Promise<void> {
  const missing = ads.filter(a => !a.image_url)
  if (missing.length === 0) return

  const { data: conn } = await db
    .from('client_connections')
    .select('connectors!inner(type, auth)')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .eq('connectors.type', 'meta_ads')
    .limit(1)
    .maybeSingle()
  if (!conn) return

  const auth = ((conn.connectors as unknown) as { auth: Record<string, unknown> }).auth ?? {}
  const accessToken = (auth.system_user_token ?? auth.access_token ?? null) as string | null
  if (!accessToken) return

  // Process in batches of 50 (Meta Graph API batch limit)
  const dbUpdates: PromiseLike<unknown>[] = []
  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50)
    try {
      const batchRequests = batch.map(ad => ({
        method: 'GET',
        relative_url: `${ad.ad_id}?fields=creative%7Bimage_url%2Cthumbnail_url%7D&thumbnail_width=1080&thumbnail_height=1080`,
      }))
      const batchUrl = new URL(`${META_BASE_URL}/`)
      batchUrl.searchParams.set('batch', JSON.stringify(batchRequests))

      // Use Authorization header — avoids logging the token in server/proxy access logs
      const res = await fetch(batchUrl.toString(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) continue

      const responses = (await res.json()) as Record<string, unknown>[]
      for (let j = 0; j < responses.length; j++) {
        const item = responses[j]
        if (!item || (item.code as number) !== 200) continue
        try {
          const data     = JSON.parse(item.body as string) as Record<string, unknown>
          const creative = data.creative as Record<string, unknown> | undefined
          const freshUrl = (creative?.image_url ?? creative?.thumbnail_url ?? null) as string | null
          if (freshUrl) {
            batch[j].image_url = freshUrl
            // Write back to all date rows for this ad so future loads skip enrichment
            dbUpdates.push(
              db.from('meta_ads_ad_metrics')
                .update({ image_url: freshUrl })
                .eq('client_id', clientId)
                .eq('ad_id', batch[j].ad_id)
            ,
            )
          }
        } catch { /* ignore per-item parse errors */ }
      }
    } catch { /* ignore batch errors */ }
  }
  await Promise.all(dbUpdates as Promise<unknown>[])
}

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
      .order('date', { ascending: false })
      .limit(200),
    db
      .from('google_ads_ad_metrics')
      .select('ad_id, ad_name, ad_status, ad_type, headlines, descriptions, image_url, ad_group_name, campaign_name, spend, impressions, clicks, conversions, date')
      .eq('client_id', clientId)
      .gte('date', ninetyDaysAgo)
      .not('ad_status', 'in', '("DELETED","REMOVED")')
      .in('ad_type', ['RESPONSIVE_DISPLAY_AD', 'DEMAND_GEN_MULTI_ASSET_AD', 'DEMAND_GEN_VIDEO_RESPONSIVE_AD', 'ASSET_GROUP'])
      .order('date', { ascending: false })
      .limit(200),
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

  const metaAds   = Array.from(metaMap.values()).filter(a => metaRecent.has(a.ad_id))
  const googleAds = Array.from(googleMap.values()).filter(a => googleRecent.has(a.ad_id))

  // Live-enrich any Meta ads whose image_url is still null — fetches fresh from
  // Meta Graph API and writes back to DB so subsequent loads are instant.
  await enrichMetaImages(db, clientId, metaAds)

  return { meta: metaAds, google: googleAds }
}
