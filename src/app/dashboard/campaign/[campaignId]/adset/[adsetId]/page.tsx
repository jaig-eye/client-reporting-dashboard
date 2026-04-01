// Ad Group / Ad Set detail — /dashboard/campaign/[campaignId]/adset/[adsetId]
//
// Bottom of the drill-down: shows individual ad cards within one ad group/set.
// Navigation: Platforms → Platform → Campaign → Ad Group (here) → Ads

import React, { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { getAgencySettings } from '@/lib/agency-settings'
import { applyAdFuel, calcDelta, fmt$, fmtNum, fmtPct, fmtCurrency, fmtRoas, getDailyTrend } from '@/lib/metrics'
import type { Client, DailyMetric } from '@/lib/types'
import type { DisplayMode } from '@/components/AdSetCards'
import type { AdCardData } from '@/components/AdSetCards'
import { AdRowTable, type AdRow } from '@/components/AdTable'
import KeywordTable, { type KeywordRow } from '@/components/KeywordTable'
import SearchAdCopy, { type SearchAdCopyRow } from '@/components/SearchAdCopy'
import NegativeKeywordList, { type NegativeKeywordRow } from '@/components/NegativeKeywordList'
import DateRangePicker from '@/components/DateRangePicker'
import SpendChart from '@/components/SpendChart'

export const dynamic = 'force-dynamic'

export default async function AdSetDetailPage({
  params,
  searchParams,
}: {
  params:       Promise<{ campaignId: string; adsetId: string }>
  searchParams: Promise<{ source?: string; from?: string; to?: string; compare?: string }>
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
  const compare     = sp.compare
  const showCompare = !!(compare && compare !== 'none')

  function d2s(d: Date) { return d.toISOString().split('T')[0] }
  const fromDate = new Date(dateFrom)
  const toDate   = new Date(dateTo)
  const periodMs = toDate.getTime() - fromDate.getTime()
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
  const isGoogleAds = source === 'google_ads'
  const groupLabel  = isGoogleAds ? 'Ad Group' : 'Ad Set'

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

  // Conversion action for Meta remapping
  const convAction: string | null = source === 'meta_ads'
    ? (isEcom ? (client.purchase_action ?? null) : (client.lead_action ?? null))
    : null

  // ── Fetch ad-level metrics for this specific ad group / ad set ─────────────
  type GoogleAdRow = {
    ad_id: string; ad_name: string; ad_type: string | null; ad_group_name: string
    ad_status: string | null; ad_strength: string | null
    headlines: string[] | null; descriptions: string[] | null
    final_url: string | null; image_url: string | null
    spend: number; impressions: number; clicks: number
    conversions: number; conversions_value: number
  }
  type MetaAdRow = {
    ad_id: string; ad_name: string; adset_name: string | null
    thumbnail_url: string | null; image_url: string | null
    video_id: string | null; video_thumb_url: string | null
    creative_body: string | null; creative_title: string | null
    ad_status: string | null
    spend: number; impressions: number; clicks: number
    conversions: number; conversion_value: number
    actions:       { action_type: string; value: string }[] | null
    action_values: { action_type: string; value: string }[] | null
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
      ex.roas             = ex.adFuelSpend > 0 && ex.conversionValue > 0 ? ex.conversionValue / ex.adFuelSpend : 0
      ex.cpl              = ex.conversions > 0 ? ex.adFuelSpend / ex.conversions : 0
      ex.ctr              = ex.impressions > 0 ? ex.clicks / ex.impressions : 0
    } else {
      adMap.set(ad.ad_id, { ...ad })
    }
  }

  type PMaxAsset = {
    asset_id: string; field_type: string
    text_content: string | null; image_url: string | null; video_id: string | null
  }
  const priorTotals = { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 }
  let dailyTrend: DailyMetric[] = []
  let priorDailyTrend: DailyMetric[] = []
  let pMaxAssets: PMaxAsset[] = []
  let isPMaxGroup = false

  if (isGoogleAds) {
    const [{ data: rows }, { data: campRow }, { data: assetRows }, { data: priorRows }] = await Promise.all([
      db.from('google_ads_ad_metrics')
        .select('ad_id,ad_name,ad_type,ad_group_name,ad_status,ad_strength,headlines,descriptions,final_url,image_url,spend,impressions,clicks,conversions,conversions_value,date')
        .eq('client_id', client.id)
        .eq('campaign_id', campaignId)
        .eq('ad_group_id', adsetId)
        .gte('date', dateFrom)
        .lte('date', dateTo),
      db.from('google_ads_metrics')
        .select('campaign_name').eq('client_id', client.id).eq('campaign_id', campaignId).limit(1).maybeSingle(),
      db.from('google_ads_asset_group_assets')
        .select('asset_id,field_type,text_content,image_url,video_id')
        .eq('client_id', client.id)
        .eq('asset_group_id', adsetId),
      showCompare
        ? db.from('google_ads_ad_metrics')
            .select('date,spend,impressions,clicks,conversions,conversions_value')
            .eq('client_id', client.id)
            .eq('campaign_id', campaignId)
            .eq('ad_group_id', adsetId)
            .gte('date', priorFrom)
            .lte('date', priorTo)
        : Promise.resolve({ data: [] as { date: string; spend: number; impressions: number; clicks: number; conversions: number; conversions_value: number }[] }),
    ])
    if (campRow) campaignName = (campRow as { campaign_name: string }).campaign_name
    isPMaxGroup = (rows ?? []).some((r: Record<string, unknown>) => r.ad_type === 'ASSET_GROUP')
    pMaxAssets = (assetRows ?? []) as PMaxAsset[]

    for (const r of (rows ?? []) as GoogleAdRow[]) {
      if (r.ad_group_name) groupName = r.ad_group_name
      const sp = Number(r.spend) || 0
      const cv = Number(r.conversions_value) || 0
      const cl = Number(r.clicks) || 0
      const im = Number(r.impressions) || 0
      const co = Number(r.conversions) || 0
      const afs = applyAdFuel(sp, adFuelCut)
      upsertAd({
        ad_id:           r.ad_id,
        ad_name:         r.ad_name,
        ad_type:         r.ad_type,
        ad_status:       r.ad_status,
        ad_strength:     r.ad_strength,
        thumbnail_url:   null,
        image_url:       r.image_url,
        video_id:        null,
        video_thumb_url: null,
        creative_body:   null,
        creative_title:  null,
        headlines:       r.headlines,
        descriptions:    r.descriptions,
        final_url:       r.final_url,
        spend:           sp, impressions: im, clicks: cl, conversions: co, conversionValue: cv,
        roas:            afs > 0 && cv > 0 ? cv / afs : 0,
        cpl:             co > 0 ? afs / co : 0,
        ctr:             im > 0 ? cl / im : 0,
        adFuelSpend:     afs,
      })
    }
    for (const r of (priorRows ?? []) as { date: string; spend: number; impressions: number; clicks: number; conversions: number; conversions_value: number }[]) {
      priorTotals.spend           += Number(r.spend)             || 0
      priorTotals.impressions     += Number(r.impressions)       || 0
      priorTotals.clicks          += Number(r.clicks)            || 0
      priorTotals.conversions     += Number(r.conversions)       || 0
      priorTotals.conversionValue += Number(r.conversions_value) || 0
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dailyTrend = getDailyTrend((rows ?? []).map((r: any) => ({ ...r, conversion_value: r.conversions_value })))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    priorDailyTrend = getDailyTrend((priorRows ?? []).map((r: any) => ({ ...r, conversion_value: r.conversions_value })))
  } else {
    const [{ data: rows }, { data: campRow }, { data: priorRows }] = await Promise.all([
      db.from('meta_ads_ad_metrics')
        .select('ad_id,ad_name,thumbnail_url,image_url,video_id,video_thumb_url,creative_body,creative_title,adset_name,ad_status,spend,impressions,clicks,conversions,conversion_value,actions,action_values,date')
        .eq('client_id', client.id)
        .eq('campaign_id', campaignId)
        .eq('adset_id', adsetId)
        .gte('date', dateFrom)
        .lte('date', dateTo),
      db.from('meta_ads_metrics')
        .select('campaign_name').eq('client_id', client.id).eq('campaign_id', campaignId).limit(1).maybeSingle(),
      showCompare
        ? db.from('meta_ads_ad_metrics')
            .select('date,spend,impressions,clicks,conversions,conversion_value,actions,action_values')
            .eq('client_id', client.id)
            .eq('campaign_id', campaignId)
            .eq('adset_id', adsetId)
            .gte('date', priorFrom)
            .lte('date', priorTo)
        : Promise.resolve({ data: [] as MetaAdRow[] }),
    ])
    if (campRow) campaignName = (campRow as { campaign_name: string }).campaign_name

    for (const r of (rows ?? []) as MetaAdRow[]) {
      if (r.adset_name) groupName = r.adset_name
      const sp = Number(r.spend) || 0
      const cl = Number(r.clicks) || 0
      const im = Number(r.impressions) || 0
      let co = Number(r.conversions) || 0
      let cv = Number(r.conversion_value) || 0
      if (convAction) {
        // When a specific action type is configured, ONLY count that action.
        // Never fall back to raw conversions (which is sum of all action types).
        const found    = (r.actions       ?? []).find(a => a.action_type === convAction)
        const foundVal = (r.action_values ?? []).find(a => a.action_type === convAction)
        co = found    ? (parseFloat(found.value)    || 0) : 0
        cv = foundVal ? (parseFloat(foundVal.value) || 0) : 0
      }
      const afs = applyAdFuel(sp, adFuelCut)
      upsertAd({
        ad_id:           r.ad_id,
        ad_name:         r.ad_name,
        ad_type:         null,
        ad_status:       r.ad_status,
        ad_strength:     null,
        thumbnail_url:   r.thumbnail_url,
        image_url:       r.image_url,
        video_id:        r.video_id,
        video_thumb_url: r.video_thumb_url,
        creative_body:   r.creative_body,
        creative_title:  r.creative_title,
        headlines:       null,
        descriptions:    null,
        final_url:       null,
        spend:           sp, impressions: im, clicks: cl, conversions: co, conversionValue: cv,
        roas:            afs > 0 && cv > 0 ? cv / afs : 0,
        cpl:             co > 0 ? afs / co : 0,
        ctr:             im > 0 ? cl / im : 0,
        adFuelSpend:     afs,
      })
    }
    for (const r of (priorRows ?? []) as MetaAdRow[]) {
      const sp = Number(r.spend) || 0
      let co   = Number(r.conversions) || 0
      let cv   = Number(r.conversion_value) || 0
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dailyTrend = getDailyTrend(rows as any[])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    priorDailyTrend = getDailyTrend(priorRows as any[])
  }

  const adCardList = Array.from(adMap.values()).sort((a, b) => b.spend - a.spend)

  // ── Keyword data (Google Search only) ────────────────────────────────────
  type KwDbRow = {
    keyword_id: string; keyword_text: string; match_type: string | null
    keyword_status: string | null; spend: number; impressions: number
    clicks: number; conversions: number
  }
  const keywordMap = new Map<string, { text: string; matchType: string | null; status: string | null; spend: number; impressions: number; clicks: number; conversions: number }>()
  if (isGoogleAds && !isPMaxGroup) {
    const { data: kwData } = await db
      .from('google_ads_keywords')
      .select('keyword_id,keyword_text,match_type,keyword_status,spend,impressions,clicks,conversions')
      .eq('client_id', client.id)
      .eq('campaign_id', campaignId)
      .eq('ad_group_id', adsetId)
      .gte('date', dateFrom)
      .lte('date', dateTo)
    for (const kw of (kwData ?? []) as KwDbRow[]) {
      const ex = keywordMap.get(kw.keyword_id)
      if (ex) {
        ex.spend       += Number(kw.spend)       || 0
        ex.impressions += Number(kw.impressions) || 0
        ex.clicks      += Number(kw.clicks)      || 0
        ex.conversions += Number(kw.conversions) || 0
      } else {
        keywordMap.set(kw.keyword_id, {
          text: kw.keyword_text, matchType: kw.match_type, status: kw.keyword_status,
          spend: Number(kw.spend)||0, impressions: Number(kw.impressions)||0,
          clicks: Number(kw.clicks)||0, conversions: Number(kw.conversions)||0,
        })
      }
    }
  }

  const keywordRows: KeywordRow[] = Array.from(keywordMap.values())
    .map(k => {
      const dSpend = adFuelCut > 0 ? applyAdFuel(k.spend, adFuelCut) : k.spend
      return {
        keyword_text:   k.text,
        match_type:     k.matchType,
        keyword_status: k.status,
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

  // ── Search ad copy rows ───────────────────────────────────────────────────
  // ── Negative keywords ────────────────────────────────────────────────────
  type NegDbRow = { keyword_id: string; keyword_text: string; match_type: string | null; level: string }
  let negativeKeywords: NegativeKeywordRow[] = []
  if (isGoogleAds && !isPMaxGroup) {
    const { data: negData } = await db
      .from('google_ads_negative_keywords')
      .select('keyword_id,keyword_text,match_type,level')
      .eq('client_id', client.id)
      .eq('campaign_id', campaignId)
    negativeKeywords = (negData ?? []).map((r: NegDbRow) => ({
      keyword_id:   r.keyword_id,
      keyword_text: r.keyword_text,
      match_type:   r.match_type,
      level:        (r.level === 'adgroup' ? 'adgroup' : 'campaign') as 'campaign' | 'adgroup',
    }))
    // Also filter ad-group-specific negatives for this adset
    const { data: agNegData } = await db
      .from('google_ads_negative_keywords')
      .select('keyword_id,keyword_text,match_type,level')
      .eq('client_id', client.id)
      .eq('campaign_id', campaignId)
      .eq('ad_group_id', adsetId)
    const agNegIds = new Set((agNegData ?? []).map((r: NegDbRow) => r.keyword_id))
    // Combine: campaign-level + this ad group's negatives, dedup
    const allNegIds = new Set(negativeKeywords.map(r => r.keyword_id + r.level))
    for (const r of (agNegData ?? []) as NegDbRow[]) {
      if (!allNegIds.has(r.keyword_id + r.level)) {
        negativeKeywords.push({ keyword_id: r.keyword_id, keyword_text: r.keyword_text, match_type: r.match_type, level: 'adgroup' })
      }
    }
    void agNegIds  // suppress unused warning
  }

  const searchAdCopyRows: SearchAdCopyRow[] = isGoogleAds && !isPMaxGroup
    ? adCardList.map(a => ({
        ad_id:        a.ad_id,
        ad_name:      a.ad_name,
        ad_type:      a.ad_type,
        ad_status:    a.ad_status,
        ad_strength:  a.ad_strength,
        headlines:    a.headlines,
        descriptions: a.descriptions,
        final_url:    a.final_url,
        impressions:  a.impressions,
        clicks:       a.clicks,
        conversions:  a.conversions,
        displaySpend: adFuelCut > 0 ? a.adFuelSpend : a.spend,
        ctr:          a.impressions > 0 ? a.clicks / a.impressions : 0,
      }))
    : []

  // Convert AdCardData → AdRow for the table
  const adRows: AdRow[] = adCardList.map(a => ({
    ad_id:           a.ad_id,
    ad_name:         a.ad_name,
    ad_type:         a.ad_type,
    ad_status:       a.ad_status,
    ad_strength:     a.ad_strength,
    image_url:       a.image_url,
    video_id:        a.video_id,
    video_thumb_url: a.video_thumb_url,
    thumbnail_url:   a.thumbnail_url,
    creative_body:   a.creative_body,
    creative_title:  a.creative_title,
    headlines:       a.headlines,
    descriptions:    a.descriptions,
    final_url:       a.final_url,
    spend:           a.spend,
    displaySpend:    adFuelCut > 0 ? a.adFuelSpend : a.spend,
    impressions:     a.impressions,
    clicks:          a.clicks,
    conversions:     a.conversions,
    conversionValue: a.conversionValue,
    roas:            a.roas,
    cpl:             a.cpl,
    ctr:             a.ctr,
  }))

  // Group totals (for the KPI summary cards above the table)
  const totSpend      = adCardList.reduce((t, a) => t + a.spend, 0)
  const totClicks     = adCardList.reduce((t, a) => t + a.clicks, 0)
  const totImpr       = adCardList.reduce((t, a) => t + a.impressions, 0)
  const totConv       = adCardList.reduce((t, a) => t + a.conversions, 0)
  const totCv         = adCardList.reduce((t, a) => t + a.conversionValue, 0)
  const totDisplaySpd = adFuelCut > 0 ? applyAdFuel(totSpend, adFuelCut) : totSpend
  const totRoas       = totDisplaySpd > 0 && totCv > 0 ? totCv / totDisplaySpd : 0
  const totCpl        = totConv > 0 ? totDisplaySpd / totConv : 0
  const totCtr        = totImpr > 0 ? totClicks / totImpr : 0

  const dateQsObj: Record<string, string> = { source, from: dateFrom, to: dateTo }
  if (compare) dateQsObj.compare = compare
  const dateQs    = new URLSearchParams(dateQsObj)
  const campHref  = `/dashboard/campaign/${encodeURIComponent(campaignId)}?${dateQs}`
  const platHref  = `/dashboard?${dateQs}`
  const rootHref  = `/dashboard?${dateQs}`

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
            href={campHref}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-muted)', textDecoration: 'none', padding: '0.3rem 0.75rem 0.3rem 0.5rem', borderRadius: '0.5rem', border: '1px solid var(--border)', background: 'var(--bg-surface)', marginBottom: '0.75rem' }}
          >
            ← {campaignName}
          </Link>
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
        {(() => {
          const prior = showCompare ? priorTotals : null
          const priorDisplaySpd = prior ? (adFuelCut > 0 ? applyAdFuel(prior.spend, adFuelCut) : prior.spend) : 0
          const priorRoas = prior && priorDisplaySpd > 0 && prior.conversionValue > 0 ? prior.conversionValue / priorDisplaySpd : 0
          const priorCpl  = prior && prior.conversions > 0 ? priorDisplaySpd / prior.conversions : 0
          const priorCtr  = prior && prior.impressions > 0 ? prior.clicks / prior.impressions : 0
          function DB({ delta, invert = false }: { delta: number | undefined; invert?: boolean }) {
            if (delta === undefined || delta === 0) return null
            const good = invert ? delta <= 0 : delta >= 0
            return <span style={{ fontSize: '0.7rem', fontWeight: 600, color: good ? 'var(--green)' : 'var(--red)' }}>{delta > 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}%</span>
          }
          return (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <div className="card p-4">
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{adFuelCut > 0 ? 'Ad Fuel Spend' : 'Spend'}</p>
                <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmt$(totDisplaySpd)}</p>
                <DB delta={calcDelta(totDisplaySpd, priorDisplaySpd)} invert />
              </div>
              {isEcom ? (
                <>
                  <div className="card p-4">
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>ROAS</p>
                    <p className="text-xl font-bold" style={{ color: totRoas >= 3 ? 'var(--green)' : totRoas >= 1.5 ? '#d97706' : totRoas > 0 ? 'var(--red)' : 'var(--text-faint)' }}>
                      {totRoas > 0 ? fmtRoas(totRoas) : '—'}
                    </p>
                    <DB delta={calcDelta(totRoas, priorRoas)} />
                  </div>
                  <div className="card p-4">
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Revenue</p>
                    <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{totCv > 0 ? fmt$(totCv) : '—'}</p>
                    <DB delta={calcDelta(totCv, prior?.conversionValue ?? 0)} />
                  </div>
                  <div className="card p-4">
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Orders</p>
                    <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{totConv > 0 ? fmtNum(totConv) : '—'}</p>
                    <DB delta={calcDelta(totConv, prior?.conversions ?? 0)} />
                  </div>
                </>
              ) : (
                <>
                  <div className="card p-4">
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{conversionLabel}</p>
                    <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{totConv > 0 ? totConv.toFixed(0) : '—'}</p>
                    <DB delta={calcDelta(totConv, prior?.conversions ?? 0)} />
                  </div>
                  <div className="card p-4">
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>CPL</p>
                    <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{totCpl > 0 ? fmtCurrency(totCpl) : '—'}</p>
                    <DB delta={calcDelta(totCpl, priorCpl)} invert />
                  </div>
                  <div className="card p-4">
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>CTR</p>
                    <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmtPct(totCtr)}</p>
                    <DB delta={calcDelta(totCtr, priorCtr)} />
                  </div>
                </>
              )}
              <div className="card p-4">
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Clicks</p>
                <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmtNum(totClicks)}</p>
                <DB delta={calcDelta(totClicks, prior?.clicks ?? 0)} />
              </div>
            </div>
          )
        })()}

        {/* ── Daily performance chart ────────────────────────── */}
        {dailyTrend.length > 0 && (
          <div className="card p-6">
            <div className="mb-4">
              <h2 className="section-title">Daily Performance</h2>
              <p className="section-desc">
                {dateFrom} – {dateTo}
                {showCompare && priorDailyTrend.length > 0 && (
                  <span style={{ color: 'var(--text-faint)', marginLeft: 8 }}>vs {priorFrom} – {priorTo}</span>
                )}
              </p>
            </div>
            <SpendChart
              data={dailyTrend}
              priorData={showCompare && priorDailyTrend.length > 0 ? priorDailyTrend : undefined}
            />
          </div>
        )}

        {/* ── pMax Asset Gallery OR Search/Display breakdown ───── */}
        {isPMaxGroup ? (
          <PMaxAssetGallery assets={pMaxAssets} groupName={groupName} />
        ) : isGoogleAds ? (
          <>
            {/* Search Ad Copy */}
            {searchAdCopyRows.length > 0 && (
              <div className="card p-6">
                <h2 className="section-title mb-4">{searchAdCopyRows.length} Ad{searchAdCopyRows.length !== 1 ? 's' : ''}</h2>
                <SearchAdCopy ads={searchAdCopyRows} />
              </div>
            )}
            {/* Keyword breakdown */}
            {keywordRows.length > 0 && (
              <div className="card p-6">
                <h2 className="section-title mb-1">Keywords</h2>
                <p className="section-desc mb-4">{keywordRows.length} keyword{keywordRows.length !== 1 ? 's' : ''} in this ad group</p>
                <KeywordTable
                  rows={keywordRows}
                  conversionLabel={conversionLabel}
                  isEcom={isEcom}
                  adFuelLabel={adFuelCut > 0 ? 'Ad Fuel Cost' : 'Spend'}
                />
              </div>
            )}
            {searchAdCopyRows.length === 0 && keywordRows.length === 0 && (
              <div className="card p-6">
                <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>
                  No ad copy or keyword data yet — run a sync to populate.
                </p>
              </div>
            )}
            {/* Negative keywords */}
            {negativeKeywords.length > 0 && (
              <div className="card p-6 space-y-4">
                <div>
                  <h2 className="section-title">Negative Keywords</h2>
                  <p className="section-desc">Keywords excluded from this campaign / ad group</p>
                </div>
                {negativeKeywords.some(k => k.level === 'campaign') && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>Campaign-level</p>
                    <NegativeKeywordList rows={negativeKeywords} level="campaign" />
                  </div>
                )}
                {negativeKeywords.some(k => k.level === 'adgroup') && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>Ad Group-level</p>
                    <NegativeKeywordList rows={negativeKeywords} level="adgroup" />
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="card p-6">
            <div className="mb-5">
              <h2 className="section-title">{adRows.length} Ad{adRows.length !== 1 ? 's' : ''}</h2>
            </div>
            <AdRowTable
              rows={adRows}
              isEcom={isEcom}
              conversionLabel={conversionLabel}
            />
          </div>
        )}

      </main>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// pMax Asset Gallery
// ─────────────────────────────────────────────────────────────────────────────

const IMAGE_TYPES = new Set(['MARKETING_IMAGE', 'SQUARE_MARKETING_IMAGE', 'PORTRAIT_MARKETING_IMAGE'])
const LOGO_TYPES  = new Set(['LOGO', 'LANDSCAPE_LOGO'])
const TEXT_LABELS: Record<string, string> = {
  HEADLINE:       'Headline',
  LONG_HEADLINE:  'Long Headline',
  DESCRIPTION:    'Description',
  BUSINESS_NAME:  'Business Name',
  CALL_TO_ACTION_SELECTION: 'Call to Action',
}

function PMaxAssetGallery({
  assets,
  groupName,
}: {
  assets:    { asset_id: string; field_type: string; text_content: string | null; image_url: string | null; video_id: string | null }[]
  groupName: string
}) {
  const images   = assets.filter(a => IMAGE_TYPES.has(a.field_type) && a.image_url)
  const logos    = assets.filter(a => LOGO_TYPES.has(a.field_type)  && a.image_url)
  const videos   = assets.filter(a => a.field_type === 'YOUTUBE_VIDEO' && a.video_id)
  const textRows = assets.filter(a => TEXT_LABELS[a.field_type]     && a.text_content)

  const empty = images.length === 0 && logos.length === 0 && videos.length === 0 && textRows.length === 0

  return (
    <div className="card p-6 space-y-6">
      <div>
        <h2 className="section-title">Asset Group — {groupName}</h2>
        <p className="section-desc">Creative assets used by this Performance Max asset group</p>
      </div>

      {empty && (
        <p className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>
          No assets synced yet. Run a sync to populate asset group creatives.
        </p>
      )}

      {/* Images */}
      {images.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-faint)' }}>Images</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {images.map(a => (
              <div key={a.asset_id + a.field_type} className="rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                <img
                  src={a.image_url!}
                  alt={a.field_type.replace(/_/g, ' ').toLowerCase()}
                  className="w-full object-cover"
                  style={{ maxHeight: 160 }}
                />
                <p className="text-xs px-2 py-1" style={{ color: 'var(--text-faint)' }}>
                  {a.field_type.replace(/_/g, ' ').toLowerCase()}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Logos */}
      {logos.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-faint)' }}>Logos</p>
          <div className="flex flex-wrap gap-3">
            {logos.map(a => (
              <div key={a.asset_id + a.field_type} className="rounded-lg overflow-hidden border p-2" style={{ borderColor: 'var(--border)', background: 'var(--bg-base)' }}>
                <img src={a.image_url!} alt="logo" className="h-12 object-contain" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Videos */}
      {videos.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-faint)' }}>Videos</p>
          <div className="flex flex-wrap gap-3">
            {videos.map(a => (
              <a
                key={a.asset_id}
                href={`https://www.youtube.com/watch?v=${a.video_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg overflow-hidden border relative"
                style={{ borderColor: 'var(--border)', width: 200 }}
              >
                <img
                  src={`https://img.youtube.com/vi/${a.video_id}/mqdefault.jpg`}
                  alt="video thumbnail"
                  className="w-full object-cover"
                />
                <div
                  className="absolute inset-0 flex items-center justify-center"
                  style={{ background: 'rgba(0,0,0,0.3)' }}
                >
                  <div
                    className="rounded-full flex items-center justify-center"
                    style={{ width: 40, height: 40, background: 'rgba(255,255,255,0.9)' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="#333">
                      <polygon points="5,3 13,8 5,13" />
                    </svg>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Text assets */}
      {textRows.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-faint)' }}>Text Assets</p>
          <div className="space-y-2">
            {(['HEADLINE', 'LONG_HEADLINE', 'DESCRIPTION', 'BUSINESS_NAME', 'CALL_TO_ACTION_SELECTION'] as const).map(ft => {
              const group = textRows.filter(a => a.field_type === ft)
              if (!group.length) return null
              return (
                <div key={ft}>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{TEXT_LABELS[ft]}</p>
                  <div className="flex flex-wrap gap-2">
                    {group.map(a => (
                      <span
                        key={a.asset_id}
                        className="text-sm px-3 py-1 rounded-full border"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-base)' }}
                      >
                        {a.text_content}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
