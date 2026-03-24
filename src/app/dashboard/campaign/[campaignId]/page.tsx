// Campaign Detail — /dashboard/campaign/[campaignId]
//
// Shows campaign KPI summary + a clickable list of ad groups / ad sets.
// Clicking an ad group navigates to the ad-level view:
//   /dashboard/campaign/[campaignId]/adset/[adsetId]
//
// Navigation: Platforms → Platform → Campaign (here) → Ad Group → Ads

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { getAgencySettings } from '@/lib/agency-settings'
import { applyAdFuel, fmt$, fmtNum, fmtRoas, fmtPct, fmtCurrency } from '@/lib/metrics'
import type { Client } from '@/lib/types'
import type { DisplayMode } from '@/components/AdSetCards'
import { AdGroupTable } from '@/components/AdTable'

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
  const sp       = await searchParams
  const source   = sp.source ?? 'google_ads'
  const dateFrom = sp.from ?? (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0] })()
  const dateTo   = sp.to ?? new Date().toISOString().split('T')[0]

  const settings  = await getAgencySettings()
  const adFuelCut = client.ad_fuel_cut != null ? client.ad_fuel_cut : settings.ad_fuel_cut

  // Campaign category → display mode + conversion label
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

  const isGoogleAds  = source === 'google_ads'
  const groupLabel   = isGoogleAds ? 'Ad Group' : 'Ad Set'

  // ── Fetch ad-level metrics ─────────────────────────────────────────────────
  type GoogleAdRow = {
    ad_id: string; ad_group_id: string; ad_group_name: string
    spend: number; impressions: number; clicks: number
    conversions: number; conversions_value: number
  }
  type MetaAdRow = {
    ad_id: string; adset_id: string | null; adset_name: string | null
    spend: number; impressions: number; clicks: number
    conversions: number; conversion_value: number
  }

  let campaignName = decodeURIComponent(campaignId)

  // Map<setId, { setName, spend, impressions, clicks, conversions, conversionValue, adCount }>
  type SetAgg = { setName: string; spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number; adIds: Set<string> }
  const setMap = new Map<string, SetAgg>()

  function upsertSet(setId: string, setName: string, adId: string, sp: number, im: number, cl: number, co: number, cv: number) {
    const ex = setMap.get(setId)
    if (ex) {
      ex.spend           += sp
      ex.impressions     += im
      ex.clicks          += cl
      ex.conversions     += co
      ex.conversionValue += cv
      ex.adIds.add(adId)
    } else {
      setMap.set(setId, { setName, spend: sp, impressions: im, clicks: cl, conversions: co, conversionValue: cv, adIds: new Set([adId]) })
    }
  }

  if (isGoogleAds) {
    const [{ data: rows }, { data: campRow }] = await Promise.all([
      db.from('google_ads_ad_metrics')
        .select('ad_id,ad_group_id,ad_group_name,spend,impressions,clicks,conversions,conversions_value')
        .eq('client_id', client.id)
        .eq('campaign_id', campaignId)
        .gte('date', dateFrom)
        .lte('date', dateTo),
      db.from('google_ads_metrics')
        .select('campaign_name').eq('client_id', client.id).eq('campaign_id', campaignId).limit(1).maybeSingle(),
    ])
    if (campRow) campaignName = (campRow as { campaign_name: string }).campaign_name
    for (const r of (rows ?? []) as GoogleAdRow[]) {
      upsertSet(r.ad_group_id, r.ad_group_name, r.ad_id, Number(r.spend)||0, Number(r.impressions)||0, Number(r.clicks)||0, Number(r.conversions)||0, Number(r.conversions_value)||0)
    }
  } else {
    const [{ data: rows }, { data: campRow }] = await Promise.all([
      db.from('meta_ads_ad_metrics')
        .select('ad_id,adset_id,adset_name,spend,impressions,clicks,conversions,conversion_value')
        .eq('client_id', client.id)
        .eq('campaign_id', campaignId)
        .gte('date', dateFrom)
        .lte('date', dateTo),
      db.from('meta_ads_metrics')
        .select('campaign_name').eq('client_id', client.id).eq('campaign_id', campaignId).limit(1).maybeSingle(),
    ])
    if (campRow) campaignName = (campRow as { campaign_name: string }).campaign_name
    for (const r of (rows ?? []) as MetaAdRow[]) {
      const setId = r.adset_id ?? r.adset_name ?? 'unknown'
      upsertSet(setId, r.adset_name ?? groupLabel, r.ad_id, Number(r.spend)||0, Number(r.impressions)||0, Number(r.clicks)||0, Number(r.conversions)||0, Number(r.conversion_value)||0)
    }
  }

  const adGroups = Array.from(setMap.entries())
    .map(([setId, s]) => {
      const adsetQs = new URLSearchParams({ source, from: dateFrom, to: dateTo })
      return {
        setId,
        setName:         s.setName,
        spend:           s.spend,
        displaySpend:    adFuelCut > 0 ? applyAdFuel(s.spend, adFuelCut) : s.spend,
        impressions:     s.impressions,
        clicks:          s.clicks,
        conversions:     s.conversions,
        conversionValue: s.conversionValue,
        adCount:         s.adIds.size,
        roas:            s.spend > 0 && s.conversionValue > 0 ? s.conversionValue / s.spend : 0,
        cpl:             s.conversions > 0 ? s.spend / s.conversions : 0,
        ctr:             s.impressions > 0 ? s.clicks / s.impressions : 0,
        href:            `/dashboard/campaign/${encodeURIComponent(campaignId)}/adset/${encodeURIComponent(setId)}?${adsetQs}`,
      }
    })
    .sort((a, b) => b.spend - a.spend)

  // Campaign-level totals
  const totSpend           = adGroups.reduce((t, s) => t + s.spend, 0)
  const totImpressions     = adGroups.reduce((t, s) => t + s.impressions, 0)
  const totClicks          = adGroups.reduce((t, s) => t + s.clicks, 0)
  const totConversions     = adGroups.reduce((t, s) => t + s.conversions, 0)
  const totConversionValue = adGroups.reduce((t, s) => t + s.conversionValue, 0)

  const dateQs  = new URLSearchParams({ source, from: dateFrom, to: dateTo })
  const backHref = `/dashboard?${dateQs}`

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
          <div className="flex items-center gap-1.5 text-xs mb-3" style={{ color: 'var(--text-faint)' }}>
            <Link href={`/dashboard?${new URLSearchParams({ from: dateFrom, to: dateTo })}`} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
              Platforms
            </Link>
            <span>/</span>
            <Link href={backHref} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
              {isGoogleAds ? 'Google Ads' : 'Meta Ads'}
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
                    background: isGoogleAds ? '#eff6ff' : '#f5f3ff',
                    color:      isGoogleAds ? '#2563eb' : '#7c3aed',
                    border:     isGoogleAds ? '1px solid #bfdbfe' : '1px solid #ddd6fe',
                  }}
                >
                  {isGoogleAds ? 'Google Ads' : 'Meta Ads'}
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

        {/* ── Campaign KPI summary ────────────────────────────── */}
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

        {/* ── Ad Group / Ad Set table ───────────────────────────── */}
        <div className="card p-6">
          <div className="mb-5">
            <h2 className="section-title">
              {adGroups.length} {groupLabel}{adGroups.length !== 1 ? 's' : ''}
            </h2>
            <p className="section-desc">Click a {groupLabel.toLowerCase()} to see individual ads</p>
          </div>
          <AdGroupTable
            rows={adGroups}
            isEcom={isEcom}
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
  spend, impressions, clicks, conversions, conversionValue,
  adFuelCut, displayMode, conversionLabel,
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
      <StatCard label={adFuelCut > 0 ? 'Ad Fuel Spend' : 'Spend'}>
        <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmt$(displaySpend)}</span>
      </StatCard>

      {isEcom ? (
        <>
          <StatCard label="ROAS">
            <span className="text-xl font-bold" style={{ color: roas > 0 ? roasColor : 'var(--text-faint)' }}>
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
          </StatCard>
          <StatCard label="CTR">
            <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmtPct(ctr)}</span>
          </StatCard>
        </>
      )}
    </div>
  )
}

function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <div className="flex items-baseline gap-1 flex-wrap">{children}</div>
    </div>
  )
}
