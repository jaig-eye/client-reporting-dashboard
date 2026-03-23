// Ad Group / Ad Set detail — /dashboard/campaign/[campaignId]/adset/[adsetId]
//
// Bottom of the drill-down: shows individual ad cards within one ad group/set.
// Navigation: Platforms → Platform → Campaign → Ad Group (here) → Ads

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { getAgencySettings } from '@/lib/agency-settings'
import { applyAdFuel, fmt$, fmtNum, fmtPct, fmtCurrency, fmtRoas } from '@/lib/metrics'
import type { Client } from '@/lib/types'
import { AdCard, type AdCardData, type DisplayMode } from '@/components/AdSetCards'

export const dynamic = 'force-dynamic'

export default async function AdSetDetailPage({
  params,
  searchParams,
}: {
  params:       Promise<{ campaignId: string; adsetId: string }>
  searchParams: Promise<{ source?: string; from?: string; to?: string }>
}) {
  const cookieStore = await cookies()
  const token = cookieStore.get('client_token')?.value
  if (!token) redirect('/access')

  const db = createAdminClient()

  const { data: clientData } = await db
    .from('clients').select('*').eq('dashboard_token', token).single()
  const client = clientData as Client | null
  if (!client) redirect('/access')

  const { campaignId, adsetId: rawAdsetId } = await params
  const adsetId  = decodeURIComponent(rawAdsetId)
  const sp       = await searchParams
  const source   = sp.source ?? 'google_ads'
  const dateFrom = sp.from ?? (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0] })()
  const dateTo   = sp.to ?? new Date().toISOString().split('T')[0]

  const settings  = await getAgencySettings()
  const adFuelCut = client.ad_fuel_cut != null ? client.ad_fuel_cut : settings.ad_fuel_cut
  const isGoogleAds = source === 'google_ads'
  const groupLabel  = isGoogleAds ? 'Ad Group' : 'Ad Set'

  // Campaign category → display mode
  const { data: assignmentData } = await db
    .from('client_campaign_assignments')
    .select('category:campaign_categories(display_mode, conversion_label)')
    .eq('client_id', client.id)
    .eq('source', source)
    .eq('campaign_id', campaignId)
    .maybeSingle()

  const catInfo         = (assignmentData?.category ?? null) as { display_mode: string; conversion_label: string } | null
  const displayMode     = (catInfo?.display_mode ?? 'lead_gen') as DisplayMode
  const conversionLabel = catInfo?.conversion_label ?? 'Conversions'
  const isEcom          = displayMode === 'ecommerce'

  // ── Fetch ad-level metrics for this specific ad group / ad set ─────────────
  type GoogleAdRow = {
    ad_id: string; ad_name: string; ad_type: string | null; ad_group_name: string
    spend: number; impressions: number; clicks: number
    conversions: number; conversions_value: number
  }
  type MetaAdRow = {
    ad_id: string; ad_name: string; thumbnail_url: string | null; adset_name: string | null
    spend: number; impressions: number; clicks: number
    conversions: number; conversion_value: number
  }

  let campaignName = decodeURIComponent(campaignId)
  let groupName    = groupLabel

  // Map<adId, AdCardData> — aggregate across date rows
  const adMap = new Map<string, AdCardData>()

  function upsertAd(ad: AdCardData) {
    const ex = adMap.get(ad.ad_id)
    if (ex) {
      ex.spend           += ad.spend
      ex.impressions     += ad.impressions
      ex.clicks          += ad.clicks
      ex.conversions     += ad.conversions
      ex.conversionValue += ad.conversionValue
      ex.adFuelSpend      = applyAdFuel(ex.spend, adFuelCut)
      ex.roas             = ex.spend > 0 && ex.conversionValue > 0 ? ex.conversionValue / ex.spend : 0
      ex.cpl              = ex.conversions > 0 ? ex.spend / ex.conversions : 0
      ex.ctr              = ex.impressions > 0 ? ex.clicks / ex.impressions : 0
    } else {
      adMap.set(ad.ad_id, { ...ad })
    }
  }

  if (isGoogleAds) {
    const [{ data: rows }, { data: campRow }] = await Promise.all([
      db.from('google_ads_ad_metrics')
        .select('ad_id,ad_name,ad_type,ad_group_name,spend,impressions,clicks,conversions,conversions_value')
        .eq('client_id', client.id)
        .eq('campaign_id', campaignId)
        .eq('ad_group_id', adsetId)
        .gte('date', dateFrom)
        .lte('date', dateTo),
      db.from('google_ads_metrics')
        .select('campaign_name').eq('client_id', client.id).eq('campaign_id', campaignId).limit(1).maybeSingle(),
    ])
    if (campRow) campaignName = (campRow as { campaign_name: string }).campaign_name

    for (const r of (rows ?? []) as GoogleAdRow[]) {
      if (r.ad_group_name) groupName = r.ad_group_name
      const sp = Number(r.spend) || 0
      const cv = Number(r.conversions_value) || 0
      const cl = Number(r.clicks) || 0
      const im = Number(r.impressions) || 0
      const co = Number(r.conversions) || 0
      upsertAd({
        ad_id:           r.ad_id,
        ad_name:         r.ad_name,
        ad_type:         r.ad_type,
        thumbnail_url:   null,
        spend:           sp, impressions: im, clicks: cl, conversions: co, conversionValue: cv,
        roas:            sp > 0 && cv > 0 ? cv / sp : 0,
        cpl:             co > 0 ? sp / co : 0,
        ctr:             im > 0 ? cl / im : 0,
        adFuelSpend:     applyAdFuel(sp, adFuelCut),
      })
    }
  } else {
    const [{ data: rows }, { data: campRow }] = await Promise.all([
      db.from('meta_ads_ad_metrics')
        .select('ad_id,ad_name,thumbnail_url,adset_name,spend,impressions,clicks,conversions,conversion_value')
        .eq('client_id', client.id)
        .eq('campaign_id', campaignId)
        .eq('adset_id', adsetId)
        .gte('date', dateFrom)
        .lte('date', dateTo),
      db.from('meta_ads_metrics')
        .select('campaign_name').eq('client_id', client.id).eq('campaign_id', campaignId).limit(1).maybeSingle(),
    ])
    if (campRow) campaignName = (campRow as { campaign_name: string }).campaign_name

    for (const r of (rows ?? []) as MetaAdRow[]) {
      if (r.adset_name) groupName = r.adset_name
      const sp = Number(r.spend) || 0
      const cv = Number(r.conversion_value) || 0
      const cl = Number(r.clicks) || 0
      const im = Number(r.impressions) || 0
      const co = Number(r.conversions) || 0
      upsertAd({
        ad_id:           r.ad_id,
        ad_name:         r.ad_name,
        ad_type:         null,
        thumbnail_url:   r.thumbnail_url,
        spend:           sp, impressions: im, clicks: cl, conversions: co, conversionValue: cv,
        roas:            sp > 0 && cv > 0 ? cv / sp : 0,
        cpl:             co > 0 ? sp / co : 0,
        ctr:             im > 0 ? cl / im : 0,
        adFuelSpend:     applyAdFuel(sp, adFuelCut),
      })
    }
  }

  const ads = Array.from(adMap.values()).sort((a, b) => b.spend - a.spend)

  // Group totals
  const totSpend      = ads.reduce((t, a) => t + a.spend, 0)
  const totClicks     = ads.reduce((t, a) => t + a.clicks, 0)
  const totImpr       = ads.reduce((t, a) => t + a.impressions, 0)
  const totConv       = ads.reduce((t, a) => t + a.conversions, 0)
  const totCv         = ads.reduce((t, a) => t + a.conversionValue, 0)
  const totDisplaySpd = adFuelCut > 0 ? applyAdFuel(totSpend, adFuelCut) : totSpend
  const totRoas       = totSpend > 0 && totCv > 0 ? totCv / totSpend : 0
  const totCpl        = totConv > 0 ? totSpend / totConv : 0
  const totCtr        = totImpr > 0 ? totClicks / totImpr : 0

  const dateQs    = new URLSearchParams({ source, from: dateFrom, to: dateTo })
  const campHref  = `/dashboard/campaign/${encodeURIComponent(campaignId)}?${dateQs}`
  const platHref  = `/dashboard?source=${source}&from=${dateFrom}&to=${dateTo}`
  const rootHref  = `/dashboard?from=${dateFrom}&to=${dateTo}`

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      {/* ── Header ──────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-10 border-b"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
      >
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-3">
          {settings.agency_logo_url && (
            <img src={settings.agency_logo_url} alt={settings.agency_name} className="max-h-7 max-w-[140px] object-contain" />
          )}
          <span className="hidden sm:block text-sm" style={{ color: 'var(--text-muted)' }}>{settings.agency_name}</span>
          <span style={{ color: 'var(--border)' }}>|</span>
          <div className="flex items-center gap-2">
            {client.logo_url && <img src={client.logo_url} alt={client.name} className="h-5 object-contain" />}
            <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{client.name}</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* ── Breadcrumb ─────────────────────────────────────── */}
        <div>
          <div className="flex items-center gap-1.5 text-xs mb-3 flex-wrap" style={{ color: 'var(--text-faint)' }}>
            <Link href={rootHref} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Platforms</Link>
            <span>/</span>
            <Link href={platHref} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>{isGoogleAds ? 'Google Ads' : 'Meta Ads'}</Link>
            <span>/</span>
            <Link href={campHref} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>{campaignName}</Link>
            <span>/</span>
            <span style={{ color: 'var(--text-secondary)' }}>{groupName}</span>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide mb-1" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>{groupLabel}</p>
              <h1 className="page-title">{groupName}</h1>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className="badge"
                  style={{
                    background: isGoogleAds ? '#eff6ff' : '#f5f3ff',
                    color:      isGoogleAds ? '#2563eb' : '#7c3aed',
                    border:     isGoogleAds ? '1px solid #bfdbfe' : '1px solid #ddd6fe',
                  }}
                >
                  {isGoogleAds ? 'Google Ads' : 'Meta Ads'}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  {dateFrom} – {dateTo}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Group KPI summary ───────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="card p-4">
            <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{adFuelCut > 0 ? 'Ad Fuel Spend' : 'Spend'}</p>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmt$(totDisplaySpd)}</p>
          </div>
          {isEcom ? (
            <>
              <div className="card p-4">
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>ROAS</p>
                <p className="text-xl font-bold" style={{ color: totRoas >= 3 ? 'var(--green)' : totRoas >= 1.5 ? '#d97706' : totRoas > 0 ? 'var(--red)' : 'var(--text-faint)' }}>
                  {totRoas > 0 ? fmtRoas(totRoas) : '—'}
                </p>
              </div>
              <div className="card p-4">
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Revenue</p>
                <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{totCv > 0 ? fmt$(totCv) : '—'}</p>
              </div>
              <div className="card p-4">
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Orders</p>
                <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{totConv > 0 ? fmtNum(totConv) : '—'}</p>
              </div>
            </>
          ) : (
            <>
              <div className="card p-4">
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{conversionLabel}</p>
                <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{totConv > 0 ? totConv.toFixed(0) : '—'}</p>
              </div>
              <div className="card p-4">
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>CPL</p>
                <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{totCpl > 0 ? fmtCurrency(totCpl) : '—'}</p>
              </div>
              <div className="card p-4">
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>CTR</p>
                <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmtPct(totCtr)}</p>
              </div>
            </>
          )}
          <div className="card p-4">
            <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Clicks</p>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmtNum(totClicks)}</p>
          </div>
        </div>

        {/* ── Ad cards ────────────────────────────────────────── */}
        <div className="card p-6">
          <div className="mb-5">
            <h2 className="section-title">{ads.length} Ad{ads.length !== 1 ? 's' : ''}</h2>
          </div>

          {ads.length === 0 ? (
            <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>
              No ad-level data found for this {groupLabel.toLowerCase()}.
            </p>
          ) : (
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}
            >
              {ads.map(ad => (
                <AdCard
                  key={ad.ad_id}
                  ad={ad}
                  isEcom={isEcom}
                  adFuelCut={adFuelCut}
                  conversionLabel={conversionLabel}
                />
              ))}
            </div>
          )}
        </div>

      </main>
    </div>
  )
}
