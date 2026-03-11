// Campaign Detail — /dashboard/campaign/[campaignId]
//
// Drill-down: Campaign → Ad Sets → Ads
// Metric emphasis adapts to campaign category display_mode:
//   lead_gen  → Leads, CPL as hero metrics; ROAS shown as estimated
//   ecommerce → ROAS, Revenue as hero metrics

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { getAgencySettings } from '@/lib/agency-settings'
import { applyAdFuel, fmt$, fmtNum, fmtRoas, fmtPct, fmtCurrency } from '@/lib/metrics'
import type { Client } from '@/lib/types'
import AdSetCards, { type AdCardData, type AdSetData, type DisplayMode } from '@/components/AdSetCards'

export const dynamic = 'force-dynamic'

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params:       Promise<{ campaignId: string }>
  searchParams: Promise<{ source?: string; connectionId?: string; from?: string; to?: string }>
}) {
  const cookieStore = await cookies()
  const token = cookieStore.get('client_token')?.value
  if (!token) redirect('/access')

  const db = createAdminClient()

  const { data: clientData } = await db
    .from('clients').select('*').eq('dashboard_token', token).single()
  const client = clientData as Client | null
  if (!client) redirect('/access')

  const { campaignId } = await params
  const sp         = await searchParams
  const source     = sp.source ?? 'google_ads'
  const dateFrom   = sp.from ?? (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0] })()
  const dateTo     = sp.to ?? new Date().toISOString().split('T')[0]

  const settings  = await getAgencySettings()
  const adFuelCut = client.ad_fuel_cut != null ? client.ad_fuel_cut : settings.ad_fuel_cut

  // Fetch campaign category → determines display mode and conversion label
  const { data: assignmentData } = await db
    .from('client_campaign_assignments')
    .select('category:campaign_categories(display_mode, conversion_label)')
    .eq('client_id', client.id)
    .eq('source', source)
    .eq('campaign_id', campaignId)
    .maybeSingle()

  const catInfo    = (assignmentData?.category ?? null) as { display_mode: string; conversion_label: string } | null
  const displayMode      = (catInfo?.display_mode ?? 'lead_gen') as DisplayMode
  const conversionLabel  = catInfo?.conversion_label ?? 'Conversions'
  const isEcom     = displayMode === 'ecommerce'

  // ── Fetch ad-level metrics ───────────────────────────────────────────────
  type GoogleAdRow = {
    ad_id: string; ad_name: string; ad_type: string | null
    ad_group_id: string; ad_group_name: string
    spend: number; impressions: number; clicks: number
    conversions: number; conversions_value: number
  }
  type MetaAdRow = {
    ad_id: string; ad_name: string; thumbnail_url: string | null
    adset_id: string | null; adset_name: string | null
    spend: number; impressions: number; clicks: number
    conversions: number; conversion_value: number
  }

  let campaignName = decodeURIComponent(campaignId)
  // Map<setId, { setName, ads: Map<ad_id, AdCardData> }>
  const setMap = new Map<string, { setName: string; ads: Map<string, AdCardData> }>()

  // Helper to upsert into setMap
  function upsertAd(setId: string, setName: string, ad: AdCardData) {
    if (!setMap.has(setId)) {
      setMap.set(setId, { setName, ads: new Map() })
    }
    const set = setMap.get(setId)!
    const ex  = set.ads.get(ad.ad_id)
    if (ex) {
      ex.spend           += ad.spend
      ex.impressions     += ad.impressions
      ex.clicks          += ad.clicks
      ex.conversions     += ad.conversions
      ex.conversionValue += ad.conversionValue
      ex.adFuelSpend      = applyAdFuel(ex.spend, adFuelCut)
      ex.roas             = ex.spend > 0 ? ex.conversionValue / ex.spend : 0
      ex.cpl              = ex.conversions > 0 ? ex.spend / ex.conversions : 0
      ex.ctr              = ex.impressions > 0 ? ex.clicks / ex.impressions : 0
    } else {
      set.ads.set(ad.ad_id, { ...ad })
    }
  }

  if (source === 'google_ads') {
    const [{ data: rows }, { data: campRow }] = await Promise.all([
      db.from('google_ads_ad_metrics')
        .select('ad_id,ad_name,ad_type,ad_group_id,ad_group_name,spend,impressions,clicks,conversions,conversions_value')
        .eq('client_id', client.id)
        .eq('campaign_id', campaignId)
        .gte('date', dateFrom)
        .lte('date', dateTo),
      db.from('google_ads_metrics')
        .select('campaign_name')
        .eq('client_id', client.id)
        .eq('campaign_id', campaignId)
        .limit(1)
        .maybeSingle(),
    ])
    if (campRow) campaignName = (campRow as { campaign_name: string }).campaign_name

    for (const r of (rows ?? []) as GoogleAdRow[]) {
      const sp = Number(r.spend) || 0
      const cv = Number(r.conversions_value) || 0
      const cl = Number(r.clicks) || 0
      const im = Number(r.impressions) || 0
      const co = Number(r.conversions) || 0
      upsertAd(r.ad_group_id, r.ad_group_name, {
        ad_id:           r.ad_id,
        ad_name:         r.ad_name,
        ad_type:         r.ad_type,
        thumbnail_url:   null,
        spend:           sp,
        impressions:     im,
        clicks:          cl,
        conversions:     co,
        conversionValue: cv,
        roas:            sp > 0 ? cv / sp : 0,
        cpl:             co > 0 ? sp / co : 0,
        ctr:             im > 0 ? cl / im : 0,
        adFuelSpend:     applyAdFuel(sp, adFuelCut),
      })
    }
  } else {
    // Meta
    const [{ data: rows }, { data: campRow }] = await Promise.all([
      db.from('meta_ads_ad_metrics')
        .select('ad_id,ad_name,thumbnail_url,adset_id,adset_name,spend,impressions,clicks,conversions,conversion_value')
        .eq('client_id', client.id)
        .eq('campaign_id', campaignId)
        .gte('date', dateFrom)
        .lte('date', dateTo),
      db.from('meta_ads_metrics')
        .select('campaign_name')
        .eq('client_id', client.id)
        .eq('campaign_id', campaignId)
        .limit(1)
        .maybeSingle(),
    ])
    if (campRow) campaignName = (campRow as { campaign_name: string }).campaign_name

    for (const r of (rows ?? []) as MetaAdRow[]) {
      const sp    = Number(r.spend) || 0
      const cv    = Number(r.conversion_value) || 0
      const cl    = Number(r.clicks) || 0
      const im    = Number(r.impressions) || 0
      const co    = Number(r.conversions) || 0
      const setId = r.adset_id ?? r.adset_name ?? 'unknown'
      upsertAd(setId, r.adset_name ?? 'Ad Set', {
        ad_id:           r.ad_id,
        ad_name:         r.ad_name,
        ad_type:         null,
        thumbnail_url:   r.thumbnail_url,
        spend:           sp,
        impressions:     im,
        clicks:          cl,
        conversions:     co,
        conversionValue: cv,
        roas:            sp > 0 ? cv / sp : 0,
        cpl:             co > 0 ? sp / co : 0,
        ctr:             im > 0 ? cl / im : 0,
        adFuelSpend:     applyAdFuel(sp, adFuelCut),
      })
    }
  }

  // Build sorted AdSetData[]
  const adSets: AdSetData[] = Array.from(setMap.entries())
    .map(([setId, s]) => {
      const ads = Array.from(s.ads.values()).sort((a, b) => b.spend - a.spend)
      const spend           = ads.reduce((t, a) => t + a.spend, 0)
      const impressions     = ads.reduce((t, a) => t + a.impressions, 0)
      const clicks          = ads.reduce((t, a) => t + a.clicks, 0)
      const conversions     = ads.reduce((t, a) => t + a.conversions, 0)
      const conversionValue = ads.reduce((t, a) => t + a.conversionValue, 0)
      return { setId, setName: s.setName, spend, impressions, clicks, conversions, conversionValue, ads }
    })
    .sort((a, b) => b.spend - a.spend)

  // Campaign-level totals
  const totSpend           = adSets.reduce((t, s) => t + s.spend, 0)
  const totImpressions     = adSets.reduce((t, s) => t + s.impressions, 0)
  const totClicks          = adSets.reduce((t, s) => t + s.clicks, 0)
  const totConversions     = adSets.reduce((t, s) => t + s.conversions, 0)
  const totConversionValue = adSets.reduce((t, s) => t + s.conversionValue, 0)
  const totAds             = adSets.reduce((t, s) => t + s.ads.length, 0)

  const backHref = `/dashboard?${new URLSearchParams({ source, from: dateFrom, to: dateTo })}`

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

        {/* ── Breadcrumb + campaign title ────────────────────── */}
        <div>
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-xs mb-3" style={{ color: 'var(--text-faint)' }}>
            <Link href="/dashboard" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
              Dashboard
            </Link>
            <span>/</span>
            <Link href={backHref} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
              {source === 'google_ads' ? 'Google Ads' : 'Meta Ads'}
            </Link>
            <span>/</span>
            <span style={{ color: 'var(--text-secondary)' }}>{campaignName}</span>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="page-title">{campaignName}</h1>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className="badge"
                  style={{
                    background: source === 'google_ads' ? '#eff6ff' : '#f5f3ff',
                    color:      source === 'google_ads' ? '#2563eb' : '#7c3aed',
                    border:     source === 'google_ads' ? '1px solid #bfdbfe' : '1px solid #ddd6fe',
                  }}
                >
                  {source === 'google_ads' ? 'Google Ads' : 'Meta Ads'}
                </span>
                {catInfo && (
                  <span className="badge badge-blue">{catInfo.display_mode.replace('_', ' ')}</span>
                )}
                <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  {dateFrom} – {dateTo}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── KPI summary ─────────────────────────────────────── */}
        <CampaignSummary
          spend={totSpend}
          impressions={totImpressions}
          clicks={totClicks}
          conversions={totConversions}
          conversionValue={totConversionValue}
          adFuelCut={adFuelCut}
          displayMode={displayMode}
          conversionLabel={conversionLabel}
        />

        {/* ── Ad Sets → Ads ───────────────────────────────────── */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="section-title">
                {adSets.length > 1
                  ? `${adSets.length} Ad Sets · ${totAds} Ads`
                  : `${totAds} Ads`
                }
              </h2>
              {!isEcom && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
                  ROAS is estimated — not connected to a CRM or purchase pipeline
                </p>
              )}
            </div>
          </div>

          <AdSetCards
            adSets={adSets}
            displayMode={displayMode}
            adFuelCut={adFuelCut}
            conversionLabel={conversionLabel}
          />
        </div>

      </main>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Campaign KPI summary — adapts to display mode
// ─────────────────────────────────────────────────────────────────────────────

function CampaignSummary({
  spend,
  impressions,
  clicks,
  conversions,
  conversionValue,
  adFuelCut,
  displayMode,
  conversionLabel,
}: {
  spend:            number
  impressions:      number
  clicks:           number
  conversions:      number
  conversionValue:  number
  adFuelCut:        number
  displayMode:      DisplayMode
  conversionLabel:  string
}) {
  const isEcom       = displayMode === 'ecommerce'
  const displaySpend = adFuelCut > 0 ? applyAdFuel(spend, adFuelCut) : spend
  const roas         = spend > 0 && conversionValue > 0 ? conversionValue / spend : 0
  const cpl          = conversions > 0 ? spend / conversions : 0
  const ctr          = impressions > 0 ? clicks / impressions : 0
  const cpc          = clicks > 0 ? spend / clicks : 0
  const roasColor    = roas >= 3 ? 'var(--green)' : roas >= 1.5 ? '#d97706' : 'var(--red)'

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      {/* Spend */}
      <StatCard label={adFuelCut > 0 ? 'Ad Fuel Spend' : 'Spend'}>
        <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmt$(displaySpend)}</span>
        {adFuelCut > 0 && <span className="text-xs ml-1" style={{ color: 'var(--text-faint)' }}>({fmt$(spend)} raw)</span>}
      </StatCard>

      {isEcom ? (
        <>
          {/* Ecommerce: ROAS hero */}
          <StatCard label="ROAS">
            <span
              className="text-xl font-bold"
              style={{ color: roas > 0 ? roasColor : 'var(--text-faint)' }}
            >
              {roas > 0 ? fmtRoas(roas) : '—'}
            </span>
          </StatCard>
          <StatCard label="Revenue">
            <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {conversionValue > 0 ? fmt$(conversionValue) : '—'}
            </span>
          </StatCard>
          <StatCard label="Orders">
            <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {conversions > 0 ? fmtNum(conversions) : '—'}
            </span>
          </StatCard>
          <StatCard label="CPC">
            <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {cpc > 0 ? fmtCurrency(cpc) : '—'}
            </span>
          </StatCard>
        </>
      ) : (
        <>
          {/* Lead Gen: CPL hero */}
          <StatCard label={conversionLabel}>
            <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {conversions > 0 ? conversions.toFixed(0) : '—'}
            </span>
          </StatCard>
          <StatCard label="CPL">
            <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {cpl > 0 ? fmtCurrency(cpl) : '—'}
            </span>
          </StatCard>
          <StatCard label="Clicks">
            <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmtNum(clicks)}</span>
            <span className="text-xs ml-1" style={{ color: 'var(--text-faint)' }}>{fmtPct(ctr)} CTR</span>
          </StatCard>
          <StatCard label="Est. ROAS" faint>
            <span className="text-xl font-bold" style={{ color: roas > 0 ? 'var(--text-muted)' : 'var(--text-faint)' }}>
              {roas > 0 ? fmtRoas(roas) : '—'}
            </span>
          </StatCard>
        </>
      )}
    </div>
  )
}

function StatCard({
  label,
  faint = false,
  children,
}: {
  label:    string
  faint?:   boolean
  children: React.ReactNode
}) {
  return (
    <div className="card p-4" style={faint ? { opacity: 0.6 } : undefined}>
      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <div className="flex items-baseline gap-1 flex-wrap">{children}</div>
    </div>
  )
}
