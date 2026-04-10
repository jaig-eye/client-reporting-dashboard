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
import { applyAdFuel, calcDelta, fmt$, fmtNum, fmtRoas, fmtPct, fmtCurrency, resolveMetaConversions } from '@/lib/metrics'
import type { Client } from '@/lib/types'
import type { DisplayMode } from '@/components/AdSetCards'
import { AdGroupTable } from '@/components/AdTable'
import SparkMetricCard from '@/components/SparkMetricCard'
import KeywordTable, { type KeywordRow } from '@/components/KeywordTable'
import DateRangePicker from '@/components/DateRangePicker'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr'

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

  // Conversion action for Meta remapping with fallback
  const convAction: string | null = source === 'meta_ads'
    ? (isEcom
        ? (client.purchase_action ?? settings.default_purchase_action ?? 'purchase')
        : (client.lead_action ?? settings.default_lead_action ?? 'onsite_conversion.lead_grouped'))
    : null
  const convActionFallback: string | null = source === 'meta_ads'
    ? (isEcom
        ? (client.purchase_action_fallback ?? settings.default_purchase_action_fallback ?? null)
        : (client.lead_action_fallback ?? settings.default_lead_action_fallback ?? 'lead'))
    : null

  // ── Fetch ad-level metrics ─────────────────────────────────────────────────
  type GoogleAdRow = {
    ad_id: string; ad_group_id: string; ad_group_name: string; date: string
    spend: number; impressions: number; clicks: number
    conversions: number; conversions_value: number
  }
  type MetaAdRow = {
    ad_id: string; adset_id: string | null; adset_name: string | null; date: string
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
  let avgImprShare: number | null = null

  // Daily series for sparklines
  type DayAgg = { spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number }
  const dailyMap = new Map<string, DayAgg>()

  function upsertDay(date: string, sp: number, im: number, cl: number, co: number, cv: number) {
    const ex = dailyMap.get(date)
    if (ex) {
      ex.spend += sp; ex.impressions += im; ex.clicks += cl; ex.conversions += co; ex.conversionValue += cv
    } else {
      dailyMap.set(date, { spend: sp, impressions: im, clicks: cl, conversions: co, conversionValue: cv })
    }
  }

  if (isGoogleAds) {
    const [{ data: rows }, { data: campRow }, { data: priorRows }] = await Promise.all([
      db.from('google_ads_ad_metrics')
        .select('ad_id,ad_group_id,ad_group_name,spend,impressions,clicks,conversions,conversions_value,date')
        .eq('client_id', client.id)
        .eq('campaign_id', campaignId)
        .gte('date', dateFrom)
        .lte('date', dateTo),
      db.from('google_ads_metrics')
        .select('campaign_name,campaign_type,search_impression_share')
        .eq('client_id', client.id).eq('campaign_id', campaignId)
        .gte('date', dateFrom).lte('date', dateTo),
      showCompare
        ? db.from('google_ads_ad_metrics')
            .select('spend,impressions,clicks,conversions,conversions_value')
            .eq('client_id', client.id)
            .eq('campaign_id', campaignId)
            .gte('date', priorFrom)
            .lte('date', priorTo)
        : Promise.resolve({ data: [] as { spend: number; impressions: number; clicks: number; conversions: number; conversions_value: number }[] }),
    ])
    const campRows = (campRow as { campaign_name: string; campaign_type: string | null; search_impression_share: number | null }[] | null) ?? []
    const firstCamp = campRows[0] ?? null
    if (firstCamp) campaignName = firstCamp.campaign_name
    isPMax = firstCamp?.campaign_type === 'PERFORMANCE_MAX'
      || campaignName.toLowerCase().startsWith('pmax')
    // Average impression share across the period (null if none available)
    const isRows = campRows.filter(r => r.search_impression_share !== null)
    avgImprShare = isRows.length > 0 ? isRows.reduce((s, r) => s + (r.search_impression_share ?? 0), 0) / isRows.length : null
    for (const r of (rows ?? []) as GoogleAdRow[]) {
      const sp = Number(r.spend)||0, im = Number(r.impressions)||0, cl = Number(r.clicks)||0
      const co = Number(r.conversions)||0, cv = Number(r.conversions_value)||0
      upsertSet(r.ad_group_id, r.ad_group_name, r.ad_id, sp, im, cl, co, cv)
      upsertDay(r.date, sp, im, cl, co, cv)
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
        .select('ad_id,adset_id,adset_name,spend,impressions,clicks,conversions,conversion_value,actions,action_values,date')
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
        const resolved = resolveMetaConversions(r.actions, r.action_values, convAction, convActionFallback)
        co = resolved.conversions
        cv = resolved.conversionValue
      }
      upsertSet(setId, r.adset_name ?? groupLabel, r.ad_id, sp, im, cl, co, cv)
      upsertDay(r.date, sp, im, cl, co, cv)
    }
    for (const r of (priorRows ?? []) as MetaAdRow[]) {
      const sp = Number(r.spend) || 0
      let co = Number(r.conversions) || 0
      let cv = Number(r.conversion_value) || 0
      if (convAction) {
        const resolved = resolveMetaConversions(r.actions, r.action_values, convAction, convActionFallback)
        co = resolved.conversions
        cv = resolved.conversionValue
      }
      priorTotals.spend           += sp
      priorTotals.impressions     += Number(r.impressions) || 0
      priorTotals.clicks          += Number(r.clicks)      || 0
      priorTotals.conversions     += co
      priorTotals.conversionValue += cv
    }
  }

  // ── Fetch campaign-level keywords (Google Search only) ────────────────────
  type KwRow = { keyword_id: string; keyword_text: string; match_type: string | null; keyword_status: string | null; spend: number; impressions: number; clicks: number; conversions: number }
  const kwMap = new Map<string, { text: string; matchType: string | null; status: string | null; spend: number; impressions: number; clicks: number; conversions: number }>()
  if (isGoogleAds && !isPMax) {
    const { data: kwData } = await db
      .from('google_ads_keywords')
      .select('keyword_id,keyword_text,match_type,keyword_status,spend,impressions,clicks,conversions')
      .eq('client_id', client.id)
      .eq('campaign_id', campaignId)
      .gte('date', dateFrom)
      .lte('date', dateTo)
    for (const kw of (kwData ?? []) as KwRow[]) {
      const key = kw.keyword_id
      const ex  = kwMap.get(key)
      if (ex) {
        ex.spend += Number(kw.spend)||0; ex.impressions += Number(kw.impressions)||0
        ex.clicks += Number(kw.clicks)||0; ex.conversions += Number(kw.conversions)||0
      } else {
        kwMap.set(key, { text: kw.keyword_text, matchType: kw.match_type ?? null, status: kw.keyword_status ?? null, spend: Number(kw.spend)||0, impressions: Number(kw.impressions)||0, clicks: Number(kw.clicks)||0, conversions: Number(kw.conversions)||0 })
      }
    }
  }

  const keywordRows: KeywordRow[] = Array.from(kwMap.values()).map(k => {
    const dSpend = adFuelCut > 0 ? applyAdFuel(k.spend, adFuelCut) : k.spend
    return { keyword_text: k.text, match_type: k.matchType, keyword_status: k.status, impressions: k.impressions, clicks: k.clicks, conversions: k.conversions, spend: k.spend, displaySpend: dSpend, ctr: k.impressions > 0 ? k.clicks / k.impressions : 0, cpc: k.clicks > 0 ? dSpend / k.clicks : 0, cpl: k.conversions > 0 ? dSpend / k.conversions : 0 }
  }).sort((a, b) => b.impressions - a.impressions)

  const convertingKeywords = keywordRows.filter(k => k.conversions > 0).sort((a, b) => b.conversions - a.conversions)
  const totalKeywords      = keywordRows.length
  const convertingCount    = convertingKeywords.length
  const convertingPct      = totalKeywords > 0 ? (convertingCount / totalKeywords) * 100 : 0
  const topConvertingKws   = convertingKeywords.slice(0, 8)

  // After data fetch: isPMax is now resolved
  const displayGroupLabel = (isGoogleAds && isPMax) ? 'Asset Group' : groupLabel
  const daysInPeriod = Math.max(1, Math.ceil((toDate.getTime() - fromDate.getTime()) / 86400000) + 1)

  const adGroups = Array.from(setMap.entries())
    .map(([setId, s]) => {
      const adsetQsObj: Record<string, string> = { source, from: dateFrom, to: dateTo }
      if (compare) adsetQsObj.compare = compare
      const adsetQs = new URLSearchParams(adsetQsObj)
      const cost    = adFuelCut > 0 ? applyAdFuel(s.spend, adFuelCut) : s.spend
      return {
        setId,
        setName:         s.setName,
        spend:           cost,
        impressions:     s.impressions,
        clicks:          s.clicks,
        conversions:     s.conversions,
        conversionValue: s.conversionValue,
        adCount:         s.adIds.size,
        cpl:             s.conversions > 0 ? cost / s.conversions : 0,
        ctr:             s.impressions > 0 ? s.clicks / s.impressions : 0,
        convRate:        s.clicks > 0 ? s.conversions / s.clicks : 0,
        href:            `/dashboard/campaign/${encodeURIComponent(campaignId)}/adset/${encodeURIComponent(setId)}?${adsetQs}`,
      }
    })
    .sort((a, b) => b.spend - a.spend)

  // Campaign-level totals (spend in adGroups is already cost after markup)
  const totSpend           = adGroups.reduce((t, s) => t + s.spend, 0)
  const totImpressions     = adGroups.reduce((t, s) => t + s.impressions, 0)
  const totClicks          = adGroups.reduce((t, s) => t + s.clicks, 0)
  const totConversions     = adGroups.reduce((t, s) => t + s.conversions, 0)
  const totConversionValue = adGroups.reduce((t, s) => t + s.conversionValue, 0)

  // KPI derived values (totSpend is already after markup)
  const displaySpend      = totSpend
  const roas              = displaySpend > 0 && totConversionValue > 0 ? totConversionValue / displaySpend : 0
  const cpl               = totConversions > 0 ? displaySpend / totConversions : 0
  const ctr               = totImpressions > 0 ? totClicks / totImpressions : 0
  const priorDisplaySpend = adFuelCut > 0 ? applyAdFuel(priorTotals.spend, adFuelCut) : priorTotals.spend
  const priorRoas         = priorDisplaySpend > 0 && priorTotals.conversionValue > 0 ? priorTotals.conversionValue / priorDisplaySpend : 0
  const priorCpl          = priorTotals.conversions > 0 ? priorDisplaySpend / priorTotals.conversions : 0
  const priorCtr          = priorTotals.impressions > 0 ? priorTotals.clicks / priorTotals.impressions : 0

  // Sparkline series from daily aggregation
  const sortedDays = Array.from(dailyMap.entries()).sort(([a], [b]) => a.localeCompare(b))
  const spendSeries = sortedDays.map(([, v]) => ({ v: adFuelCut > 0 ? applyAdFuel(v.spend, adFuelCut) : v.spend }))
  const convSeries  = sortedDays.map(([, v]) => ({ v: v.conversions }))
  const cvSeries    = sortedDays.map(([, v]) => ({ v: v.conversionValue }))
  const cplSeries   = sortedDays.map(([, v]) => {
    const ds = adFuelCut > 0 ? applyAdFuel(v.spend, adFuelCut) : v.spend
    return { v: v.conversions > 0 ? ds / v.conversions : 0 }
  })
  const ctrSeries   = sortedDays.map(([, v]) => ({ v: v.impressions > 0 ? v.clicks / v.impressions : 0 }))
  const clicksSeries = sortedDays.map(([, v]) => ({ v: v.clicks }))

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

        {/* ── Back + Breadcrumb ──────────────────────────────── */}
        <div>
          <Link
            href={backHref}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-muted)', textDecoration: 'none', padding: '0.3rem 0.75rem 0.3rem 0.5rem', borderRadius: '0.5rem', border: '1px solid var(--border)', background: 'var(--bg-surface)', marginBottom: '0.75rem' }}
          >
            ← {isGoogleAds ? 'Google Ads' : 'Meta Ads'}
          </Link>
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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SparkMetricCard
            label="Cost"
            value={fmt$(displaySpend)}
            delta={showCompare ? calcDelta(displaySpend, priorDisplaySpend) : undefined}
            invertDelta
            sparkData={spendSeries}
            sparkColor="var(--blue)"
            delay={0}
          />
          {isEcom ? (
            <>
              <SparkMetricCard
                label="ROAS"
                value={roas > 0 ? fmtRoas(roas) : '—'}
                delta={showCompare && priorRoas > 0 ? calcDelta(roas, priorRoas) : undefined}
                sparkData={sortedDays.map(([, v]) => {
                  const ds = adFuelCut > 0 ? applyAdFuel(v.spend, adFuelCut) : v.spend
                  return { v: ds > 0 && v.conversionValue > 0 ? v.conversionValue / ds : 0 }
                })}
                sparkColor="var(--green)"
                delay={1}
              />
              <SparkMetricCard
                label="Revenue"
                value={totConversionValue > 0 ? fmt$(totConversionValue) : '—'}
                delta={showCompare ? calcDelta(totConversionValue, priorTotals.conversionValue) : undefined}
                sparkData={cvSeries}
                sparkColor="var(--green)"
                delay={2}
              />
              <SparkMetricCard
                label={conversionLabel}
                value={totConversions > 0 ? fmtNum(totConversions) : '—'}
                delta={showCompare ? calcDelta(totConversions, priorTotals.conversions) : undefined}
                sparkData={convSeries}
                sparkColor="#8b5cf6"
                delay={3}
              />
            </>
          ) : (
            <>
              <SparkMetricCard
                label={conversionLabel}
                value={totConversions > 0 ? totConversions.toFixed(0) : '—'}
                delta={showCompare ? calcDelta(totConversions, priorTotals.conversions) : undefined}
                sparkData={convSeries}
                sparkColor="var(--green)"
                delay={1}
              />
              <SparkMetricCard
                label="CPL"
                value={cpl > 0 ? fmtCurrency(cpl) : '—'}
                delta={showCompare && priorCpl > 0 ? calcDelta(cpl, priorCpl) : undefined}
                invertDelta
                sparkData={cplSeries}
                sparkColor="#f59e0b"
                delay={2}
              />
              <SparkMetricCard
                label="CTR"
                value={fmtPct(ctr)}
                delta={showCompare ? calcDelta(ctr, priorCtr) : undefined}
                sparkData={ctrSeries}
                sparkColor="var(--blue)"
                delay={3}
              />
            </>
          )}
        </div>

        {/* ── Clicks card (always visible) ─────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SparkMetricCard
            label="Clicks"
            value={fmtNum(totClicks)}
            delta={showCompare ? calcDelta(totClicks, priorTotals.clicks) : undefined}
            sparkData={clicksSeries}
            sparkColor="#8b5cf6"
            delay={4}
          />
          <SparkMetricCard
            label="Impressions"
            value={fmtNum(totImpressions)}
            delta={showCompare ? calcDelta(totImpressions, priorTotals.impressions) : undefined}
            sparkData={sortedDays.map(([, v]) => ({ v: v.impressions }))}
            sparkColor="var(--text-muted)"
            delay={5}
          />
          {isGoogleAds && !isPMax && avgImprShare !== null && (
            <SparkMetricCard
              label="Impr. Share"
              value={`${(avgImprShare * 100).toFixed(1)}%`}
              sparkData={[]}
              sparkColor="#6366f1"
              delay={6}
            />
          )}
        </div>

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
            conversionLabel={conversionLabel}
            isPMax={isGoogleAds && isPMax}
          />
        </div>

        {/* ── Keyword Intelligence (Google Search only) ────────── */}
        {isGoogleAds && !isPMax && keywordRows.length > 0 && (
          <div className="card p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <MagnifyingGlass size={16} aria-hidden style={{ color: 'var(--blue)' }} />
                  <h2 className="section-title">Keyword Intelligence</h2>
                </div>
                <p className="section-desc">Top converting keywords across all ad groups in this campaign</p>
              </div>
              {totalKeywords > 0 && (
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-right">
                    <p className="text-2xl font-bold" style={{ color: 'var(--green)', fontVariantNumeric: 'tabular-nums' }}>
                      {convertingCount}<span className="text-sm font-normal" style={{ color: 'var(--text-faint)' }}>/{totalKeywords}</span>
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-faint)' }}>converting ({convertingPct.toFixed(0)}%)</p>
                  </div>
                  <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
                    <circle cx="20" cy="20" r="16" fill="none" stroke="var(--bg-subtle)" strokeWidth="4" />
                    <circle cx="20" cy="20" r="16" fill="none" stroke="var(--green)" strokeWidth="4"
                      strokeLinecap="round"
                      strokeDasharray={`${(convertingPct / 100) * 100.53} 100.53`}
                      transform="rotate(-90 20 20)"
                    />
                  </svg>
                </div>
              )}
            </div>

            {topConvertingKws.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {topConvertingKws.map((kw, i) => (
                  <SparkMetricCard
                    key={`${kw.keyword_text}-${i}`}
                    label={kw.keyword_text.length > 24 ? kw.keyword_text.slice(0, 22) + '…' : kw.keyword_text}
                    value={fmtNum(kw.conversions)}
                    sparkData={[]}
                    sparkColor="var(--green)"
                    delay={i}
                  />
                ))}
              </div>
            )}

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1.25rem' }}>
              <h3 className="section-label mb-3">All Keywords ({keywordRows.length})</h3>
              <KeywordTable rows={keywordRows} conversionLabel={conversionLabel} adFuelLabel="Cost" />
            </div>
          </div>
        )}

      </main>
    </div>
  )
}
