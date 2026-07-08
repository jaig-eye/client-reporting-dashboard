import { createAdminClient } from '@/lib/supabase/server'
import { AdLibraryView }     from '@/components/public/AdLibraryView'
import type { MetaAdRow, GoogleAdRow } from '@/app/api/public/ads/route'

export const dynamic = 'force-dynamic'

export default async function ShareAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  if (!token) return <InvalidLink />

  const db = createAdminClient()

  const { data: client } = await db
    .from('clients')
    .select('id, name')
    .eq('dashboard_token', token)
    .maybeSingle()

  if (!client) return <InvalidLink />

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

  const metaAds   = Array.from(metaMap.values())
  const googleAds = Array.from(googleMap.values())
  const total     = metaAds.length + googleAds.length

  return (
    <div style={{ minHeight: '100vh', background: '#f8f9fb' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 1.5rem' }}>
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', margin: 0 }}>
            {client.name}
          </h1>
          <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
            Ad Library · Last 30 days · {total} {total === 1 ? 'ad' : 'ads'}
          </p>
        </div>
        <AdLibraryView meta={metaAds} google={googleAds} />
      </div>
    </div>
  )
}

function InvalidLink() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f8f9fb',
    }}>
      <div style={{ textAlign: 'center', padding: '3rem' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#111827', marginBottom: '0.5rem' }}>
          Link invalid or expired
        </h1>
        <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: 0 }}>
          Ask your account manager for a new link.
        </p>
      </div>
    </div>
  )
}
