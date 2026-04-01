// Campaign Detail — /dashboard/campaign/[campaignId]
//
// Shows campaign KPI summary + a clickable list of ad groups / ad sets.
// Clicking an ad group navigates to the ad-level view:
//   /dashboard/campaign/[campaignId]/adset/[adsetId]
//
// Navigation: Platforms → Platform → Campaign (here) → Ad Group → Ads

import React, { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { getAgencySettings } from '@/lib/agency-settings'
import { applyAdFuel, calcDelta, fmt$, fmtNum, fmtRoas, fmtPct, fmtCurrency } from '@/lib/metrics'
import type { Client } from '@/lib/types'
import type { DisplayMode } from '@/components/AdSetCards'
import { AdGroupTable } from '@/components/AdTable'
import KeywordTable, { type KeywordRow } from '@/components/KeywordTable'
import DateRangePicker from '@/components/DateRangePicker'

export const dynamic = 'force-dynamic'

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params:       Promise<{ campaignId: string }>
  searchParams: Promise<{ source?: string; connectionId?: string; from?: string; to?: string; compare?: string }>
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
  const compare      = sp.compare
  const showCompare  = !!(compare && compare !== 'none')

  function d2s(d: Date) { return d.toISOString().split('T')[0] }
  const fromDate  = new Date(dateFrom)
  const toDate    = new Date(dateTo)
  const periodMs  = toDate.getTime() - fromDate.getTime()
  let priorFrom: string
  let priorTo:   string
  if (compare === 'last_year') {
    priorFrom = `${fromDate.getFullYear() - 1}${dateFrom.slice(4)}`
    priorTo   = `${toDate.getFullYear() - 1}${dateTo.slice(4)}`
  } else {
    const pTo   = new Date(fromDate.getTime() - 86400000)
    const pFrom = new Date(pTo.getTime() - periodMs)
    priorFrom   = d2s(pFrom)
    priorTo     = d2s(pTo)
  }

  const settings  = await getAgencySettings()
  const adFuelCut = client.ad_fuel_cut != null ? client.ad_fuel_cut : settings.ad_fuel_cut

  // Campaign display mode — set per-campaign in client settings
  const { data: assignmentData } = await db
    .from('client_campaign_assignments')
    .select('display_mode, conversion_label')
    .eq('client_id', client.id)
    .eq('source', source)
    .eq('campaign_id', campaignId)
    .maybeSingle()

  const displayMode     = ((assignmentData?.display_mode as string | null) ?? 'lead_gen') as DisplayMode
  const conversionLabel = (assignmentData?.conversion_label as string | null)
    ?? (displayMode === 'ecommerce' ? 'Purchases' : 'Leads')
  const isEcom          = displayMode === 'ecommerce'

  const isGoogleAds  = source === 'google_ads'
  const groupLabel   = isGoogleAds ? 'Ad Group' : 'Ad Set'

  // Conversion action for Meta remapping (same logic as dashboard overview)
  const convAction: string | null = source === 'meta_ads'
    ? (isEcom ? (client.purchase_action ?? null) : (client.lead_action ?? null))
    : null

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
    actions:      { action_type: string; value: string }[] | null
    action_values: { action_type: string; value: string }[] | null
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

  const priorTotals = { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 }
  let isPMax = false

  if (isGoogleAds) {
    const [{ data: rows }, { data: campRow }, { data: priorRows }] = await Promise.all([
      db.from('google_ads_ad_metrics')
        .select('ad_id,ad_group_id,ad_group_name,spend,impressions,clicks,conversions,conversions_value')
        .eq('client_id', client.id)
        .eq('campaign_id', campaignId)
        .gte('date', dateFrom)
        .lte('date', dateTo),
      db.from('google_ads_metrics')
        .select('campaign_name,campaign_type').eq('client_id', client.id).eq('campaign_id', campaignId).limit(1).maybeSingle(),
      showCompare
        ? db.from('google_ads_ad_metrics')
            .select('spend,impressions,clicks,conversions,conversions_value')
            .eq('client_id', client.id)
            .eq('campaign_id', campaignId)
            .gte('date', priorFrom)
            .lte('date', priorTo)
        : Promise.resolve({ data: [] as { spend: number; impressions: number; clicks: number; conversions: number; conversions_value: number }[] }),
    ])
    const typedCampRow = campRow as { campaign_name: string; campaign_type: string | null } | null
    if (typedCampRow) campaignName = typedCampRow.campaign_name
    isPMax = typedCampRow?.campaign_type === 'PERFORMANCE_MAX'
      || campaignName.toLowerCase().startsWith('pmax')
    for (const r of (rows ?? []) as GoogleAdRow[]) {
      upsertSet(r.ad_group_id, r.ad_group_name, r.ad_id, Number(r.spend)||0, Number(r.impressions)||0, Number(r.clicks)||0, Number(r.conversions)||0, Number(r.conversions_value)||0)
    }
    for (const r of (priorRows ?? []) as { spend: number; impressions: number; clicks: number; conversions: number; conversions_value: number }[]) {
      priorTotals.spend           += Number(r.spend)            || 0
      priorTotals.impressions     += Number(r.impressions)      || 0
      priorTotals.clicks          += Number(r.clicks)           || 0
      priorTotals.conversions     += Number(r.conversions)      || 0
      priorTotals.conversionValue += Number(r.conversions_value) || 0
    }
  } else {
    const [{ data: rows }, { data: campRow }, { data: priorRows }] = await Promise.all([
      db.from('meta_ads_ad_metrics')
        .select('ad_id,adset_id,adset_name,spend,impressions,clicks,conversions,conversion_value,actions,action_values')
        .eq('client_id', client.id)
        .eq('campaign_id', campaignId)
        .gte('date', dateFrom)
        .lte('date', dateTo),
      db.from('meta_ads_metrics')
        .select('campaign_name').eq('client_id', client.id).eq('campaign_id', campaignId).limit(1).maybeSingle(),
      showCompare
        ? db.from('meta_ads_ad_metrics')
            .select('spend,impressions,clicks,conversions,conversion_value,actions,action_values')
            .eq('client_id', client.id)
            .eq('campaign_id', campaignId)
            .gte('date', priorFrom)
            .lte('date', priorTo)
        : Promise.resolve({ data: [] as MetaAdRow[] }),
    ])
    if (campRow) campaignName = (campRow as { campaign_name: string }).campaign_name
    for (const r of (rows ?? []) as MetaAdRow[]) {
      const setId = r.adset_id ?? r.adset_name ?? 'unknown'
      const sp = Number(r.spend) || 0
      const im = Number(r.impressions) || 0
      const cl = Number(r.clicks) || 0
      let co = Number(r.conversions) || 0
      let cv = Number(r.conversion_value) || 0
      if (convAction) {
        const found    = (r.actions       ?? []).find(a => a.action_type === convAction)
        const foundVal = (r.action_values ?? []).find(a => a.action_type === convAction)
        co = found    ? (parseFloat(found.value)    || 0) : 0
        cv = foundVal ? (parseFloat(foundVal.value) || 0) : 0
      }
      upsertSet(setId, r.adset_name ?? groupLabel, r.ad_id, sp, im, cl, co, cv)
    }
    for (const r of (priorRows ?? []) as MetaAdRow[]) {
      const sp = Number(r.spend) || 0
      let co = Number(r.conversions) || 0
      let cv = Number(r.conversion_value) || 0
      if (convAction) {
        const found    = (r.actions       ?? []).find(a => a.action_type === convAction)
        const foundVal = (r.action_values ?? []).find(a => a.action_type === convAction)
        co = found    ? (parseFloat(found.value)    || 0) : 0
        cv = foundVal ? (parseFloat(foundVal.value) || 0) : 0
      }
      priorTotals.spend           += sp
      priorTotals.impressions     += Number(r.impressions) || 0
      priorTotals.clicks          += Number(r.clicks)      || 0
      priorTotals.conversions     += co
      priorTotals.conversionValue += cv
    }
  }

  // After data fetch: isPMax is now resolved
  const displayGroupLabel = (isGoogleAds && isPMax) ? 'Asset Group' : groupLabel

  // ── Campaign-level keywords (Search only — skip PMax / Meta) ─────────────
  type KwCampRow = {
    keyword_text: string; match_type: string | null; spend: number
    impressions: number; clicks: number; conversions: number
  }
  type KwKey = string  // `${keyword_text}|||${match_type}`
  const kwCampMap = new Map<KwKey, { text: string; matchType: string | null; spend: number; impressions: number; clicks: number; conversions: number }>()
  if (isGoogleAds && !isPMax) {
    const { data: kwData } = await db
      .from('google_ads_keywords')
      .select('keyword_text,match_type,spend,impressions,clicks,conversions')
      .eq('client_id', client.id)
      .eq('campaign_id', campaignId)
      .gte('date', dateFrom)
      .lte('date', dateTo)
    for (const kw of (kwData ?? []) as KwCampRow[]) {
      const key: KwKey = `${kw.keyword_text}|||${kw.match_type ?? ''}`
      const ex = kwCampMap.get(key)
      if (ex) {
        ex.spend       += Number(kw.spend)       || 0
        ex.impressions += Number(kw.impressions) || 0
        ex.clicks      += Number(kw.clicks)      || 0
        ex.conversions += Number(kw.conversions) || 0
      } else {
        kwCampMap.set(key, {
          text: kw.keyword_text, matchType: kw.match_type ?? null,
          spend: Number(kw.spend)||0, impressions: Number(kw.impressions)||0,
          clicks: Number(kw.clicks)||0, conversions: Number(kw.conversions)||0,
        })
      }
    }
  }
  const campaignKeywordRows: KeywordRow[] = Array.from(kwCampMap.values())
    .map(k => {
      const dSpend = adFuelCut > 0 ? applyAdFuel(k.spend, adFuelCut) : k.spend
      return {
        keyword_text:   k.text,
        match_type:     k.matchType,
        keyword_status: null,
        impressions:    k.impressions,
        clicks:         k.clicks,
        conversions:    k.conversions,
        spend:          k.spend,
        displaySpend:   dSpend,
        ctr:            k.impressions > 0 ? k.clicks / k.impressions : 0,
        cpc:            k.clicks > 0      ? dSpend / k.clicks        : 0,
        cpl:            k.conversions > 0 ? dSpend / k.conversions   : 0,
      }
    })
    .sort((a, b) => b.impressions - a.impressions)

  const adGroups = Array.from(setMap.entries())
    .map(([setId, s]) => {
      const adsetQsObj: Record<string, string> = { source, from: dateFrom, to: dateTo }
      if (compare) adsetQsObj.compare = compare
      const adsetQs = new URLSearchParams(adsetQsObj)
      const dSpend  = adFuelCut > 0 ? applyAdFuel(s.spend, adFuelCut) : s.spend
      return {
        setId,
        setName:         s.setName,
        spend:           s.spend,
        displaySpend:    dSpend,
        impressions:     s.impressions,
        clicks:          s.clicks,
        conversions:     s.conversions,
        conversionValue: s.conversionValue,
        adCount:         s.adIds.size,
        roas:            dSpend > 0 && s.conversionValue > 0 ? s.conversionValue / dSpend : 0,
        cpl:             s.conversions > 0 ? dSpend / s.conversions : 0,
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

  const dateQsObj: Record<string, string> = { source, from: dateFrom, to: dateTo }
  if (compare) dateQsObj.compare = compare
  const dateQs   = new URLSearchParams(dateQsObj)
  const backHref = `/dashboard?${dateQs}`

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      {/* ── Header ──────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-10 border-b"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
      >
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {settings.agency_logo_url && (
              <img src={settings.agency_logo_url} alt={settings.agency_name} className="max-h-7 max-w-[140px] object-contain flex-shrink-0" />
            )}
            <span className="hidden sm:block text-sm flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{settings.agency_name}</span>
            <span style={{ color: 'var(--border)' }}>|</span>
            <div className="flex items-center gap-2 min-w-0">
              {client.logo_url && <img src={client.logo_url} alt={client.name} className="h-5 object-contain flex-shrink-0" />}
              <span className="font-semibold text-sm truncate" style={{ color: 'var(--text-primary)' }}>{client.name}</span>
            </div>
          </div>
          <div className="flex-shrink-0">
            <Suspense fallback={null}>
              <DateRangePicker from={dateFrom} to={dateTo} compare={compare} />
            </Suspense>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* ── Breadcrumb ─────────────────────────────────────── */}
        <div>
          <div className="flex items-center gap-1.5 text-xs mb-3" style={{ color: 'var(--text-faint)' }}>
            <Link href={`/dashboard?${dateQs}`} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
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
                <span className={`badge ${displayMode === 'ecommerce' ? 'badge-blue' : 'badge-green'}`}>
                  {displayMode === 'ecommerce' ? 'Ecommerce' : 'Lead Gen'}
                </span>
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
          prior={showCompare ? priorTotals : undefined}
        />

        {/* ── Ad Group / Ad Set table ───────────────────────────── */}
        <div className="card p-6">
          <div className="mb-5">
            <h2 className="section-title">
              {adGroups.length} {displayGroupLabel}{adGroups.length !== 1 ? 's' : ''}
            </h2>
            <p className="section-desc">Click a {displayGroupLabel.toLowerCase()} to see individual ads</p>
          </div>
          <AdGroupTable
            rows={adGroups}
            isEcom={isEcom}
            conversionLabel={conversionLabel}
            isPMax={isGoogleAds && isPMax}
          />
        </div>

        {/* ── Campaign-level keyword breakdown (Search only) ──────── */}
        {campaignKeywordRows.length > 0 && (
          <div className="card p-6">
            <h2 className="section-title mb-1">Keywords</h2>
            <p className="section-desc mb-4">{campaignKeywordRows.length} keyword{campaignKeywordRows.length !== 1 ? 's' : ''} across all ad groups</p>
            <KeywordTable
              rows={campaignKeywordRows}
              conversionLabel={conversionLabel}
              isEcom={isEcom}
              adFuelLabel={adFuelCut > 0 ? 'Ad Fuel Cost' : 'Spend'}
            />
          </div>
        )}

      </main>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Campaign KPI summary — adapts to display mode
// ─────────────────────────────────────────────────────────────────────────────

type PriorTotalsType = { spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number }

function DeltaBadge({ delta, invert = false }: { delta: number | undefined; invert?: boolean }) {
  if (delta === undefined || delta === 0) return null
  const isGood = invert ? delta <= 0 : delta >= 0
  return (
    <span style={{ fontSize: '0.7rem', fontWeight: 600, color: isGood ? 'var(--green)' : 'var(--red)' }}>
      {delta > 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}%
    </span>
  )
}

function CampaignSummary({
  spend, impressions, clicks, conversions, conversionValue,
  adFuelCut, displayMode, conversionLabel, prior,
}: {
  spend:            number
  impressions:      number
  clicks:           number
  conversions:      number
  conversionValue:  number
  adFuelCut:        number
  displayMode:      DisplayMode
  conversionLabel:  string
  prior?:           PriorTotalsType
}) {
  const isEcom        = displayMode === 'ecommerce'
  const displaySpend  = adFuelCut > 0 ? applyAdFuel(spend, adFuelCut) : spend
  const roas          = displaySpend > 0 && conversionValue > 0 ? conversionValue / displaySpend : 0
  const cpl           = conversions > 0 ? displaySpend / conversions : 0
  const ctr           = impressions > 0 ? clicks / impressions : 0
  const cpc           = clicks > 0 ? displaySpend / clicks : 0
  const roasColor     = roas >= 3 ? 'var(--green)' : roas >= 1.5 ? '#d97706' : 'var(--red)'

  const priorDisplaySpend = prior ? (adFuelCut > 0 ? applyAdFuel(prior.spend, adFuelCut) : prior.spend) : 0
  const priorRoas = prior && priorDisplaySpend > 0 && prior.conversionValue > 0 ? prior.conversionValue / priorDisplaySpend : 0
  const priorCpl  = prior && prior.conversions > 0 ? priorDisplaySpend / prior.conversions : 0
  const priorCtr  = prior && prior.impressions > 0 ? prior.clicks / prior.impressions : 0
  const priorCpc  = prior && prior.clicks > 0 ? priorDisplaySpend / prior.clicks : 0

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <StatCard label={adFuelCut > 0 ? 'Ad Fuel Spend' : 'Spend'}>
        <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmt$(displaySpend)}</span>
        <DeltaBadge delta={calcDelta(displaySpend, priorDisplaySpend)} invert />
      </StatCard>

      {isEcom ? (
        <>
          <StatCard label="ROAS">
            <span className="text-xl font-bold" style={{ color: roas > 0 ? roasColor : 'var(--text-faint)' }}>
              {roas > 0 ? fmtRoas(roas) : '—'}
            </span>
            <DeltaBadge delta={calcDelta(roas, priorRoas)} />
          </StatCard>
          <StatCard label="Revenue">
            <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {conversionValue > 0 ? fmt$(conversionValue) : '—'}
            </span>
            <DeltaBadge delta={calcDelta(conversionValue, prior?.conversionValue ?? 0)} />
          </StatCard>
          <StatCard label="Orders">
            <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {conversions > 0 ? fmtNum(conversions) : '—'}
            </span>
            <DeltaBadge delta={calcDelta(conversions, prior?.conversions ?? 0)} />
          </StatCard>
          <StatCard label="CPC">
            <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {cpc > 0 ? fmtCurrency(cpc) : '—'}
            </span>
            <DeltaBadge delta={calcDelta(cpc, priorCpc)} invert />
          </StatCard>
        </>
      ) : (
        <>
          <StatCard label={conversionLabel}>
            <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {conversions > 0 ? conversions.toFixed(0) : '—'}
            </span>
            <DeltaBadge delta={calcDelta(conversions, prior?.conversions ?? 0)} />
          </StatCard>
          <StatCard label="CPL">
            <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {cpl > 0 ? fmtCurrency(cpl) : '—'}
            </span>
            <DeltaBadge delta={calcDelta(cpl, priorCpl)} invert />
          </StatCard>
          <StatCard label="Clicks">
            <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmtNum(clicks)}</span>
            <DeltaBadge delta={calcDelta(clicks, prior?.clicks ?? 0)} />
          </StatCard>
          <StatCard label="CTR">
            <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmtPct(ctr)}</span>
            <DeltaBadge delta={calcDelta(ctr, priorCtr)} />
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
