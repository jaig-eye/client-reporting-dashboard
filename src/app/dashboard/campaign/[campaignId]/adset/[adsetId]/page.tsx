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
import { applyAdFuel, calcDelta, fmt$, fmtNum, fmtPct, fmtCurrency, fmtRoas, getDailyTrend, resolveMetaConversions } from '@/lib/metrics'
import type { Client, DailyMetric } from '@/lib/types'
import type { DisplayMode } from '@/components/AdSetCards'
import type { AdCardData } from '@/components/AdSetCards'
import { AdRowTable, type AdRow } from '@/components/AdTable'
import PMaxAssetSlider from '@/components/PMaxAssetSlider'
import KeywordTable, { type KeywordRow } from '@/components/KeywordTable'
import SearchAdCopy, { type SearchAdCopyRow } from '@/components/SearchAdCopy'
import NegativeKeywordList, { type NegativeKeywordRow } from '@/components/NegativeKeywordList'
import DateRangePicker from '@/components/DateRangePicker'
import SpendChart from '@/components/SpendChart'
import SparkMetricCard from '@/components/SparkMetricCard'
import MetricCard from '@/components/MetricCard'
import TabContainer from '@/components/TabContainer'
import {
  resolvePaidAdsLayout, resolvePlatformLayout, resolveMetaMediaLayout,
  METRIC_LABELS, type MetricLayouts, type MetricKey,
} from '@/lib/metric-layouts'

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
  // Meta adset IDs are always numeric strings. If the URL param is non-numeric it means
  // the campaign page fell back to adset_name as the key (adset_id was null in DB).
  const adsetIdIsNumeric = /^\d+$/.test(adsetId)
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
  const rawMode            = cookieStore.get('admin_raw_mode')?.value === '1'
  const effectiveAdFuelCut = rawMode ? 0 : adFuelCut
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
  const conversionLabel = (assignmentData?.conversion_label as string | null) ?? 'Conversions'
  const isEcom          = displayMode === 'ecommerce'

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
      // Accumulate metrics
      ex.spend           += ad.spend
      ex.impressions     += ad.impressions
      ex.clicks          += ad.clicks
      ex.conversions     += ad.conversions
      ex.conversionValue += ad.conversionValue
      ex.adFuelSpend      = applyAdFuel(ex.spend, effectiveAdFuelCut)
      ex.roas             = ex.adFuelSpend > 0 && ex.conversionValue > 0 ? ex.conversionValue / ex.adFuelSpend : 0
      ex.cpl              = ex.conversions > 0 ? ex.adFuelSpend / ex.conversions : 0
      ex.ctr              = ex.impressions > 0 ? ex.clicks / ex.impressions : 0
      // Prefer non-empty metadata — later rows (more recent dates) override stale/empty values
      if (ad.ad_name)        ex.ad_name        = ad.ad_name
      if (ad.image_url)      ex.image_url      = ad.image_url
      if (ad.thumbnail_url)  ex.thumbnail_url  = ad.thumbnail_url
      if (ad.video_id)       ex.video_id       = ad.video_id
      if (ad.ad_status)      ex.ad_status      = ad.ad_status
      if (ad.creative_body)  ex.creative_body  = ad.creative_body
      if (ad.creative_title) ex.creative_title = ad.creative_title
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
  let isPMaxGroup      = false
  let campTypeRaw      = ''
  let avgImprShare:      number | null = null
  let priorAvgImprShare: number | null = null

  if (isGoogleAds) {
    const [{ data: rows }, { data: campRow }, { data: assetRows }, { data: priorRows }, { data: isData }, { data: priorIsData }] = await Promise.all([
      db.from('google_ads_ad_metrics')
        .select('ad_id,ad_name,ad_type,ad_group_name,ad_status,ad_strength,headlines,descriptions,final_url,image_url,spend,impressions,clicks,conversions,conversions_value,date')
        .eq('client_id', client.id)
        .eq('campaign_id', campaignId)
        .eq('ad_group_id', adsetId)
        .gte('date', dateFrom)
        .lte('date', dateTo),
      db.from('google_ads_metrics')
        .select('campaign_name,campaign_type').eq('client_id', client.id).eq('campaign_id', campaignId).limit(1).maybeSingle(),
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
      // Campaign-level impression share for this adset's parent campaign
      db.from('google_ads_metrics')
        .select('search_impression_share')
        .eq('client_id', client.id)
        .eq('campaign_id', campaignId)
        .gte('date', dateFrom)
        .lte('date', dateTo),
      showCompare
        ? db.from('google_ads_metrics')
            .select('search_impression_share')
            .eq('client_id', client.id)
            .eq('campaign_id', campaignId)
            .gte('date', priorFrom)
            .lte('date', priorTo)
        : Promise.resolve({ data: [] as { search_impression_share: number | null }[] }),
    ])
    if (campRow) campaignName = (campRow as { campaign_name: string; campaign_type?: string | null }).campaign_name
    campTypeRaw  = ((campRow as { campaign_type?: string | null } | null)?.campaign_type ?? '').toUpperCase()
    isPMaxGroup = (rows ?? []).some((r: Record<string, unknown>) => r.ad_type === 'ASSET_GROUP')
    pMaxAssets = (assetRows ?? []) as PMaxAsset[]

    for (const r of (rows ?? []) as GoogleAdRow[]) {
      if (r.ad_group_name) groupName = r.ad_group_name
      const sp = Number(r.spend) || 0
      const cv = Number(r.conversions_value) || 0
      const cl = Number(r.clicks) || 0
      const im = Number(r.impressions) || 0
      const co = Number(r.conversions) || 0
      const afs = applyAdFuel(sp, effectiveAdFuelCut)
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
    // Compute impression share from campaign-level data (IS is not available at ad group level)
    const isFiltered = (isData ?? []).filter(r => r.search_impression_share !== null)
    avgImprShare = isFiltered.length > 0
      ? isFiltered.reduce((s, r) => s + (r.search_impression_share ?? 0), 0) / isFiltered.length : null
    const priorIsFiltered = (priorIsData ?? []).filter(r => r.search_impression_share !== null)
    priorAvgImprShare = priorIsFiltered.length > 0
      ? priorIsFiltered.reduce((s, r) => s + (r.search_impression_share ?? 0), 0) / priorIsFiltered.length : null
  } else {
    // Two-query approach for Meta:
    //   1. Current metadata query (no date filter) — gives us ALL ads in this adset
    //      with their current names, images, and statuses regardless of date range.
    //   2. Metrics query (date filtered) — gives us spend/impressions/clicks for the period.
    // Merging them means ads always appear even if they have zero metrics in the range.
    //
    // WHY SEQUENTIAL: When adsetIdIsNumeric, metaQ filters by adset_id. Older rows in the DB
    // may have adset_id=NULL (the sync used adset_id: value || undefined, omitting the field).
    // Running metaQ first lets us extract the adset_name, then metricsQ can filter by
    // adset_name instead — which is always populated and catches ALL rows for the adset.

    // Step 1 — current metadata (no date filter)
    const { data: metaRows } = await (adsetIdIsNumeric
      ? db.from('meta_ads_ad_metrics')
          .select('ad_id,ad_name,thumbnail_url,image_url,video_id,video_thumb_url,creative_body,creative_title,adset_name,ad_status')
          .eq('client_id', client.id).eq('campaign_id', campaignId)
          .eq('adset_id', adsetId).neq('ad_id', adsetId)
          .order('date', { ascending: false }).limit(1000)
      : db.from('meta_ads_ad_metrics')
          .select('ad_id,ad_name,thumbnail_url,image_url,video_id,video_thumb_url,creative_body,creative_title,adset_name,ad_status')
          .eq('client_id', client.id).eq('campaign_id', campaignId)
          .eq('adset_name', adsetId)
          .order('date', { ascending: false }).limit(1000))

    // Extract adset_name from metadata — this is always present even in rows where adset_id was null
    const resolvedAdsetName = (metaRows as MetaAdRow[] | null)?.find(r => r.adset_name)?.adset_name ?? null

    // Step 2 — date-filtered metrics query.
    // When adsetIdIsNumeric: prefer filtering by adset_name (covers old rows where adset_id=NULL)
    // over filtering by adset_id (misses any row where adset_id was omitted during upsert).
    const metricsQ = adsetIdIsNumeric && resolvedAdsetName
      ? db.from('meta_ads_ad_metrics')
          .select('ad_id,ad_name,thumbnail_url,image_url,video_id,video_thumb_url,creative_body,creative_title,adset_name,ad_status,spend,impressions,clicks,conversions,conversion_value,actions,action_values,date')
          .eq('client_id', client.id).eq('campaign_id', campaignId)
          .gte('date', dateFrom).lte('date', dateTo)
          .eq('adset_name', resolvedAdsetName).neq('ad_id', adsetId)
      : adsetIdIsNumeric
      ? db.from('meta_ads_ad_metrics')
          .select('ad_id,ad_name,thumbnail_url,image_url,video_id,video_thumb_url,creative_body,creative_title,adset_name,ad_status,spend,impressions,clicks,conversions,conversion_value,actions,action_values,date')
          .eq('client_id', client.id).eq('campaign_id', campaignId)
          .gte('date', dateFrom).lte('date', dateTo)
          .eq('adset_id', adsetId).neq('ad_id', adsetId)
      : db.from('meta_ads_ad_metrics')
          .select('ad_id,ad_name,thumbnail_url,image_url,video_id,video_thumb_url,creative_body,creative_title,adset_name,ad_status,spend,impressions,clicks,conversions,conversion_value,actions,action_values,date')
          .eq('client_id', client.id).eq('campaign_id', campaignId)
          .gte('date', dateFrom).lte('date', dateTo)
          .eq('adset_name', adsetId)

    // Prior period query — same adset_name strategy
    const priorQ = showCompare
      ? adsetIdIsNumeric && resolvedAdsetName
        ? db.from('meta_ads_ad_metrics')
            .select('date,spend,impressions,clicks,conversions,conversion_value,actions,action_values')
            .eq('client_id', client.id).eq('campaign_id', campaignId)
            .gte('date', priorFrom).lte('date', priorTo)
            .eq('adset_name', resolvedAdsetName).neq('ad_id', adsetId)
        : adsetIdIsNumeric
        ? db.from('meta_ads_ad_metrics')
            .select('date,spend,impressions,clicks,conversions,conversion_value,actions,action_values')
            .eq('client_id', client.id).eq('campaign_id', campaignId)
            .gte('date', priorFrom).lte('date', priorTo)
            .eq('adset_id', adsetId).neq('ad_id', adsetId)
        : db.from('meta_ads_ad_metrics')
            .select('date,spend,impressions,clicks,conversions,conversion_value,actions,action_values')
            .eq('client_id', client.id).eq('campaign_id', campaignId)
            .gte('date', priorFrom).lte('date', priorTo)
            .eq('adset_name', adsetId)
      : Promise.resolve({ data: [] as MetaAdRow[] })

    const [{ data: rows }, { data: campRow }, { data: priorRows }] = await Promise.all([
      metricsQ,
      db.from('meta_ads_metrics')
        .select('campaign_name').eq('client_id', client.id).eq('campaign_id', campaignId).limit(1).maybeSingle(),
      priorQ,
    ])
    if (campRow) campaignName = (campRow as { campaign_name: string }).campaign_name

    // Build current metadata map — first row per ad_id is the most recent (ordered by date desc)
    const currentMeta = new Map<string, MetaAdRow>()
    for (const r of (metaRows ?? []) as MetaAdRow[]) {
      if (!adsetIdIsNumeric && r.ad_name?.startsWith('[Ad Set]')) continue
      if (!currentMeta.has(r.ad_id)) {
        currentMeta.set(r.ad_id, r)  // first row = most recent date
        if (r.adset_name) groupName = r.adset_name
      }
    }

    // Pre-populate adMap from currentMeta so all known ads appear even with zero metrics
    for (const [adId, meta] of Array.from(currentMeta)) {
      adMap.set(adId, {
        ad_id:           adId,
        ad_name:         meta.ad_name,
        ad_type:         null,
        ad_status:       meta.ad_status,
        ad_strength:     null,
        thumbnail_url:   meta.thumbnail_url,
        image_url:       meta.image_url,
        video_id:        meta.video_id,
        video_thumb_url: meta.video_thumb_url,
        creative_body:   meta.creative_body,
        creative_title:  meta.creative_title,
        headlines: null, descriptions: null, final_url: null,
        spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0,
        roas: 0, cpl: 0, ctr: 0, adFuelSpend: 0,
      })
    }

    // Accumulate period metrics — metadata fields ignored (currentMeta is authoritative)
    for (const r of (rows ?? []) as (MetaAdRow & { date: string })[]) {
      if (!adsetIdIsNumeric && r.ad_name?.startsWith('[Ad Set]')) continue
      const sp = Number(r.spend) || 0
      const cl = Number(r.clicks) || 0
      const im = Number(r.impressions) || 0
      let co = Number(r.conversions) || 0
      let cv = Number(r.conversion_value) || 0
      if (convAction) {
        const resolved = resolveMetaConversions(r.actions, r.action_values, convAction, convActionFallback)
        co = resolved.conversions
        cv = resolved.conversionValue
      }
      const afs = applyAdFuel(sp, effectiveAdFuelCut)
      const meta = currentMeta.get(r.ad_id)
      upsertAd({
        ad_id:           r.ad_id,
        // Always use currentMeta for display fields; fall back to row value if not in map
        ad_name:         meta?.ad_name         ?? r.ad_name,
        ad_type:         null,
        ad_status:       meta?.ad_status        ?? r.ad_status,
        ad_strength:     null,
        thumbnail_url:   meta?.thumbnail_url    ?? r.thumbnail_url,
        image_url:       meta?.image_url        ?? r.image_url,
        video_id:        meta?.video_id         ?? r.video_id,
        video_thumb_url: meta?.video_thumb_url  ?? r.video_thumb_url,
        creative_body:   meta?.creative_body    ?? r.creative_body,
        creative_title:  meta?.creative_title   ?? r.creative_title,
        headlines: null, descriptions: null, final_url: null,
        spend: sp, impressions: im, clicks: cl, conversions: co, conversionValue: cv,
        roas:        afs > 0 && cv > 0 ? cv / afs : 0,
        cpl:         co > 0 ? afs / co : 0,
        ctr:         im > 0 ? cl / im : 0,
        adFuelSpend: afs,
      })
    }
    for (const r of (priorRows ?? []) as MetaAdRow[]) {
      const sp = Number(r.spend) || 0
      let co   = Number(r.conversions) || 0
      let cv   = Number(r.conversion_value) || 0
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
    // Remap conversions for chart using convAction with fallback
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const remapMeta = (r: any) => {
      let co = Number(r.conversions) || 0
      let cv = Number(r.conversion_value) || 0
      if (convAction) {
        const resolved = resolveMetaConversions(r.actions, r.action_values, convAction, convActionFallback)
        co = resolved.conversions
        cv = resolved.conversionValue
      }
      return { date: r.date, spend: r.spend, conversions: co, conversion_value: cv, clicks: r.clicks, impressions: Number(r.impressions) || 0 }
    }
    dailyTrend = getDailyTrend((rows ?? []).map(remapMeta))
    priorDailyTrend = getDailyTrend((priorRows ?? []).map(remapMeta))
  }

  const adCardList = Array.from(adMap.values()).sort((a, b) => b.spend - a.spend)

  // ── Keyword data (Google Search only) ────────────────────────────────────
  type KwDbRow = {
    keyword_id: string; keyword_text: string; match_type: string | null
    keyword_status: string | null; spend: number; impressions: number
    clicks: number; conversions: number; date: string
  }
  type KwAgg = { text: string; matchType: string | null; status: string | null; spend: number; impressions: number; clicks: number; conversions: number; daily: Map<string, { spend: number; conversions: number; clicks: number }> }
  const keywordMap = new Map<string, KwAgg>()
  if (isGoogleAds && !isPMaxGroup) {
    const { data: kwData } = await db
      .from('google_ads_keywords')
      .select('keyword_id,keyword_text,match_type,keyword_status,spend,impressions,clicks,conversions,date')
      .eq('client_id', client.id)
      .eq('campaign_id', campaignId)
      .eq('ad_group_id', adsetId)
      .gte('date', dateFrom)
      .lte('date', dateTo)
    for (const kw of (kwData ?? []) as KwDbRow[]) {
      const sp = Number(kw.spend)||0, im = Number(kw.impressions)||0, cl = Number(kw.clicks)||0, co = Number(kw.conversions)||0
      const ex = keywordMap.get(kw.keyword_id)
      if (ex) {
        ex.spend += sp; ex.impressions += im; ex.clicks += cl; ex.conversions += co
        const dayEx = ex.daily.get(kw.date)
        if (dayEx) { dayEx.spend += sp; dayEx.conversions += co; dayEx.clicks += cl }
        else ex.daily.set(kw.date, { spend: sp, conversions: co, clicks: cl })
      } else {
        const daily = new Map<string, { spend: number; conversions: number; clicks: number }>()
        daily.set(kw.date, { spend: sp, conversions: co, clicks: cl })
        keywordMap.set(kw.keyword_id, { text: kw.keyword_text, matchType: kw.match_type, status: kw.keyword_status, spend: sp, impressions: im, clicks: cl, conversions: co, daily })
      }
    }
  }

  const keywordRows: KeywordRow[] = Array.from(keywordMap.values())
    .map(k => {
      const dSpend = effectiveAdFuelCut > 0 ? applyAdFuel(k.spend, effectiveAdFuelCut) : k.spend
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

  // Converting keywords — filtered + enriched with daily sparkline data
  const convertingKeywords = Array.from(keywordMap.entries())
    .filter(([, k]) => k.conversions > 0)
    .sort(([, a], [, b]) => b.conversions - a.conversions)
    .slice(0, 8)
    .map(([id, k]) => {
      const dSpend = effectiveAdFuelCut > 0 ? applyAdFuel(k.spend, effectiveAdFuelCut) : k.spend
      const dailySorted = Array.from(k.daily.entries()).sort(([a], [b]) => a.localeCompare(b))
      return {
        id,
        text:       k.text,
        matchType:  k.matchType,
        conversions: k.conversions,
        spend:       dSpend,
        cpl:         k.conversions > 0 ? dSpend / k.conversions : 0,
        ctr:         k.impressions > 0 ? k.clicks / k.impressions : 0,
        sparkConv:   dailySorted.map(([, d]) => ({ v: d.conversions })),
        sparkSpend:  dailySorted.map(([, d]) => ({ v: effectiveAdFuelCut > 0 ? applyAdFuel(d.spend, effectiveAdFuelCut) : d.spend })),
      }
    })
  const totalKeywords      = keywordMap.size
  const convertingKwCount  = Array.from(keywordMap.values()).filter(k => k.conversions > 0).length
  const convertingKwPct    = totalKeywords > 0 ? (convertingKwCount / totalKeywords * 100) : 0

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

  // ── Search terms for this ad group (Google Search only) ─────────────────────
  type StDbRow = { search_term: string; match_type: string | null; status: string | null; impressions: number; clicks: number; spend: number; conversions: number; conversion_value: number }
  const searchTermMap = new Map<string, { matchType: string | null; status: string | null; impressions: number; clicks: number; spend: number; conversions: number; convValue: number }>()
  if (isGoogleAds && !isPMaxGroup && adsetIdIsNumeric) {
    const { data: stData } = await db
      .from('google_ads_search_terms')
      .select('search_term,match_type,status,impressions,clicks,spend,conversions,conversion_value')
      .eq('client_id', client.id)
      .eq('ad_group_id', adsetId)
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .order('impressions', { ascending: false })
      .limit(500)
    for (const st of (stData ?? []) as StDbRow[]) {
      const ex = searchTermMap.get(st.search_term)
      if (ex) {
        ex.impressions += Number(st.impressions)||0; ex.clicks += Number(st.clicks)||0
        ex.spend += Number(st.spend)||0; ex.conversions += Number(st.conversions)||0
        ex.convValue += Number(st.conversion_value)||0
      } else {
        searchTermMap.set(st.search_term, { matchType: st.match_type, status: st.status, impressions: Number(st.impressions)||0, clicks: Number(st.clicks)||0, spend: Number(st.spend)||0, conversions: Number(st.conversions)||0, convValue: Number(st.conversion_value)||0 })
      }
    }
  }
  const searchTermRows = Array.from(searchTermMap.entries())
    .map(([term, v]) => {
      const dSpend = effectiveAdFuelCut > 0 ? applyAdFuel(v.spend, effectiveAdFuelCut) : v.spend
      return { term, matchType: v.matchType, status: v.status, impressions: v.impressions, clicks: v.clicks, spend: v.spend, displaySpend: dSpend, conversions: v.conversions, convValue: v.convValue, ctr: v.impressions > 0 ? v.clicks / v.impressions : 0, cpc: v.clicks > 0 ? dSpend / v.clicks : 0, cpl: v.conversions > 0 ? dSpend / v.conversions : 0 }
    })
    .sort((a, b) => b.impressions - a.impressions)

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
        displaySpend: effectiveAdFuelCut > 0 ? a.adFuelSpend : a.spend,
        ctr:          a.impressions > 0 ? a.clicks / a.impressions : 0,
      }))
    : []

  // Convert AdCardData → AdRow for the table
  const adRows: AdRow[] = adCardList.map(a => {
    const cost = effectiveAdFuelCut > 0 ? a.adFuelSpend : a.spend
    return {
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
      spend:           cost,
      impressions:     a.impressions,
      clicks:          a.clicks,
      conversions:     a.conversions,
      conversionValue: a.conversionValue,
      cpl:             a.cpl,
      ctr:             a.ctr,
      convRate:        a.clicks > 0 ? a.conversions / a.clicks : 0,
    }
  })

  // Group totals (for the KPI summary cards above the table)
  const totSpend      = adCardList.reduce((t, a) => t + a.spend, 0)
  const totClicks     = adCardList.reduce((t, a) => t + a.clicks, 0)
  const totImpr       = adCardList.reduce((t, a) => t + a.impressions, 0)
  const totConv       = adCardList.reduce((t, a) => t + a.conversions, 0)
  const totCv         = adCardList.reduce((t, a) => t + a.conversionValue, 0)
  const totDisplaySpd = effectiveAdFuelCut > 0 ? applyAdFuel(totSpend, effectiveAdFuelCut) : totSpend
  const totRoas       = totDisplaySpd > 0 && totCv > 0 ? totCv / totDisplaySpd : 0
  const totCpl        = totConv > 0 ? totDisplaySpd / totConv : 0
  const totCtr        = totImpr > 0 ? totClicks / totImpr : 0

  // ── Layout resolution ─────────────────────────────────────────────────────
  const isGoogleSearch = isGoogleAds && !isPMaxGroup && campTypeRaw.includes('SEARCH')
  const isGoogleShop   = isGoogleAds && (isPMaxGroup || campTypeRaw.includes('SHOPPING'))

  const agencyLayouts  = settings.metric_layouts as MetricLayouts | null | undefined
  const clientOverride = client.metric_layout_override as MetricLayouts | null | undefined
  const isMetaMedia    = source === 'meta_ads' && (displayMode === 'awareness' || displayMode === 'engagement')
  const adsetLayout    = isGoogleSearch
    ? resolvePlatformLayout(agencyLayouts, clientOverride, 'google_search')
    : isGoogleShop
    ? resolvePlatformLayout(agencyLayouts, clientOverride, 'google_shopping')
    : isMetaMedia
    ? resolveMetaMediaLayout(agencyLayouts, clientOverride, isEcom)
    : resolvePaidAdsLayout(agencyLayouts, clientOverride, isEcom)

  const adsColumns: string[] | undefined = 'ads_table_columns' in adsetLayout
    ? (adsetLayout as { ads_table_columns?: string[] }).ads_table_columns
    : undefined

  // ── Metric value / spark / delta maps ─────────────────────────────────────
  const invertDeltaKeys = new Set(['spend', 'cpa', 'cpl', 'cpm', 'cpc'])

  const prior           = showCompare ? priorTotals : null
  const priorDisplaySpd = prior ? (effectiveAdFuelCut > 0 ? applyAdFuel(prior.spend, effectiveAdFuelCut) : prior.spend) : 0
  const priorRoas       = prior && priorDisplaySpd > 0 && prior.conversionValue > 0 ? prior.conversionValue / priorDisplaySpd : 0
  const priorCpl        = prior && prior.conversions > 0 ? priorDisplaySpd / prior.conversions : 0
  const priorCtr        = prior && prior.impressions > 0 ? prior.clicks / prior.impressions : 0

  // DailyMetric has: date, spend, conversions, clicks, roas (no impressions/conversionValue)
  const spendSpark  = dailyTrend.map(d => ({ v: effectiveAdFuelCut > 0 ? applyAdFuel(d.spend, effectiveAdFuelCut) : d.spend }))
  const convSpark   = dailyTrend.map(d => ({ v: d.conversions }))
  const cvSpark     = dailyTrend.map(d => { const ds = effectiveAdFuelCut > 0 ? applyAdFuel(d.spend, effectiveAdFuelCut) : d.spend; return { v: d.roas > 0 ? d.roas * ds : 0 } })
  const clicksSpark = dailyTrend.map(d => ({ v: d.clicks }))
  const cplSpark    = dailyTrend.map(d => { const ds = effectiveAdFuelCut > 0 ? applyAdFuel(d.spend, effectiveAdFuelCut) : d.spend; return { v: d.conversions > 0 ? ds / d.conversions : 0 } })
  const roasSpark   = dailyTrend.map(d => ({ v: d.roas }))
  const cpcSpark    = dailyTrend.map(d => { const ds = effectiveAdFuelCut > 0 ? applyAdFuel(d.spend, effectiveAdFuelCut) : d.spend; return { v: d.clicks > 0 ? ds / d.clicks : 0 } })
  const crSpark     = dailyTrend.map(d => ({ v: d.clicks > 0 ? d.conversions / d.clicks : 0 }))

  const adsetValMap: Record<string, string> = {
    spend:       fmt$(totDisplaySpd),
    leads:       totConv > 0        ? fmtNum(totConv)               : '—',
    conversions: totConv > 0        ? fmtNum(totConv)               : '—',
    revenue:     totCv > 0          ? fmt$(totCv)                   : '—',
    roas:        totRoas > 0        ? fmtRoas(totRoas)              : '—',
    cpa:         totCpl > 0         ? fmtCurrency(totCpl)           : '—',
    ctr:         fmtPct(totCtr),
    clicks:      fmtNum(totClicks),
    impressions: fmtNum(totImpr),
    cpm:         totImpr > 0        ? fmtCurrency((totDisplaySpd / totImpr) * 1000) : '—',
    cpc:         totClicks > 0      ? fmtCurrency(totDisplaySpd / totClicks) : '—',
    conv_rate:   totClicks > 0      ? fmtPct(totConv / totClicks)  : '—',
    impression_share: avgImprShare != null ? `${(avgImprShare * 100).toFixed(1)}%` : '—',
  }
  const adsetCurrNum: Record<string, number> = {
    spend: totDisplaySpd, leads: totConv, conversions: totConv,
    revenue: totCv, roas: totRoas, cpa: totCpl, ctr: totCtr,
    clicks: totClicks, impressions: totImpr,
    cpm: totImpr > 0 ? (totDisplaySpd / totImpr) * 1000 : 0,
    cpc: totClicks > 0 ? totDisplaySpd / totClicks : 0,
    conv_rate: totClicks > 0 ? totConv / totClicks : 0,
    impression_share: avgImprShare ?? 0,
  }
  const adsetPriorNum: Record<string, number> = {
    spend: priorDisplaySpd, leads: prior?.conversions ?? 0, conversions: prior?.conversions ?? 0,
    revenue: prior?.conversionValue ?? 0, roas: priorRoas, cpa: priorCpl, ctr: priorCtr,
    clicks: prior?.clicks ?? 0, impressions: prior?.impressions ?? 0,
    cpm: (prior?.impressions ?? 0) > 0 ? (priorDisplaySpd / (prior?.impressions ?? 1)) * 1000 : 0,
    cpc: (prior?.clicks ?? 0) > 0 ? priorDisplaySpd / (prior?.clicks ?? 1) : 0,
    conv_rate: (prior?.clicks ?? 0) > 0 ? (prior?.conversions ?? 0) / (prior?.clicks ?? 1) : 0,
    impression_share: priorAvgImprShare ?? 0,
  }
  const adsetSparkMap: Record<string, { v: number }[]> = {
    spend: spendSpark, leads: convSpark, conversions: convSpark, revenue: cvSpark,
    roas: roasSpark, cpa: cplSpark, ctr: [], clicks: clicksSpark,
    impressions: [], cpm: [], cpc: cpcSpark, conv_rate: crSpark,
    impression_share: [],
  }
  const adsetSparkColorMap: Record<string, string> = {
    spend: 'var(--blue)', roas: 'var(--green)', revenue: 'var(--green)',
    leads: 'var(--green)', conversions: 'var(--green)', cpa: '#f59e0b',
    ctr: 'var(--blue)', clicks: '#8b5cf6', impressions: 'var(--text-muted)',
    cpm: '#f59e0b', cpc: '#f59e0b', conv_rate: 'var(--green)', impression_share: '#6366f1',
  }
  function getAdsetMetricLabel(key: string): string {
    if (key === 'conversions' || key === 'leads') return conversionLabel
    return METRIC_LABELS[key as MetricKey] ?? key
  }

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

        {/* ── Group KPI summary (layout-driven) ──────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {adsetLayout.kpi_cards.map((key, i) => (
            <SparkMetricCard
              key={key}
              label={getAdsetMetricLabel(key)}
              value={adsetValMap[key] ?? '—'}
              delta={showCompare && adsetCurrNum[key] !== undefined
                ? calcDelta(adsetCurrNum[key] ?? 0, adsetPriorNum[key] ?? 0)
                : undefined}
              invertDelta={invertDeltaKeys.has(key)}
              sparkData={adsetSparkMap[key] ?? []}
              sparkColor={adsetSparkColorMap[key] ?? 'var(--blue)'}
              delay={i}
            />
          ))}
        </div>

        {adsetLayout.top_metrics.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {adsetLayout.top_metrics.map((key, i) => (
              <MetricCard
                key={key}
                label={getAdsetMetricLabel(key)}
                value={adsetValMap[key] ?? '—'}
                delta={showCompare && adsetCurrNum[key] !== undefined
                  ? calcDelta(adsetCurrNum[key] ?? 0, adsetPriorNum[key] ?? 0)
                  : undefined}
                invertDelta={invertDeltaKeys.has(key)}
                delay={adsetLayout.kpi_cards.length + i}
              />
            ))}
          </div>
        )}

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
              colorSpend={settings.chart_color_spend}
              colorPriorSpend={settings.chart_color_prior_spend}
              colorConversions={settings.chart_color_conversions}
              colorPriorConversions={settings.chart_color_prior_conversions}
            />
          </div>
        )}

        {/* ── pMax Asset Gallery OR Tabbed breakdown ───── */}
        {isPMaxGroup ? (
          <PMaxAssetGallery assets={pMaxAssets} groupName={groupName} />
        ) : isGoogleAds && (keywordRows.length > 0 || negativeKeywords.length > 0 || searchTermRows.length > 0) ? (
          /* Google Search: tabbed view with Keywords, Ads, Negative Keywords */
          <div className="card p-6">
            {/* Keyword Intelligence summary (above tabs) */}
            {convertingKeywords.length > 0 && (
              <div className="mb-5">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h2 className="section-title">Keyword Intelligence</h2>
                    <p className="section-desc">Top converting keywords in this ad group</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-right">
                      <p className="text-2xl font-bold" style={{ color: 'var(--green)' }}>
                        {convertingKwCount}<span className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}>/{totalKeywords}</span>
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>converting ({convertingKwPct.toFixed(0)}%)</p>
                    </div>
                    <div style={{ width: 48, height: 48, position: 'relative' }}>
                      <svg viewBox="0 0 48 48" style={{ transform: 'rotate(-90deg)' }}>
                        <circle cx="24" cy="24" r="20" fill="none" stroke="var(--border)" strokeWidth="4" />
                        <circle cx="24" cy="24" r="20" fill="none" stroke="var(--green)" strokeWidth="4" strokeDasharray={`${convertingKwPct * 1.257} 125.7`} strokeLinecap="round" />
                      </svg>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {convertingKeywords.map((kw, i) => (
                    <SparkMetricCard
                      key={kw.id}
                      label={kw.text}
                      value={`${kw.conversions} ${conversionLabel.toLowerCase()}`}
                      sub={`CPL ${fmtCurrency(kw.cpl)} · CTR ${fmtPct(kw.ctr)}`}
                      sparkData={kw.sparkConv}
                      sparkColor="var(--green)"
                      delay={i}
                    />
                  ))}
                </div>
              </div>
            )}

            {(() => {
              const tabDefs: { label: string; count: number }[] = []
              const panels: React.ReactNode[] = []

              if (keywordRows.length > 0) {
                tabDefs.push({ label: 'Keywords', count: keywordRows.length })
                panels.push(
                  <div key="kw">
                    <KeywordTable
                      rows={keywordRows}
                      conversionLabel={conversionLabel}
                      isEcom={isEcom}
                      adFuelLabel="Cost"
                    />
                  </div>
                )
              }

              if (searchAdCopyRows.length > 0 || adRows.length > 0) {
                tabDefs.push({ label: 'Ads', count: searchAdCopyRows.length || adRows.length })
                panels.push(
                  <div key="ads">
                    {searchAdCopyRows.length > 0 ? (
                      <SearchAdCopy ads={searchAdCopyRows} />
                    ) : (
                      <AdRowTable
                        rows={adRows}
                        conversionLabel={conversionLabel}
                        tableColumns={adsColumns}
                        clientId={client.id}
                      />
                    )}
                  </div>
                )
              }

              if (searchTermRows.length > 0) {
                tabDefs.push({ label: 'Search Terms', count: searchTermRows.length })
                panels.push(
                  <div key="st">
                    <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                      Actual search queries that triggered ads in this ad group during the selected period.
                    </p>
                    <div className="overflow-x-auto">
                      <table className="data-table" style={{ minWidth: 600 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left' }}>Search Term</th>
                            <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Match</th>
                            <th style={{ textAlign: 'right' }}>Impr.</th>
                            <th style={{ textAlign: 'right' }}>Clicks</th>
                            <th style={{ textAlign: 'right' }}>CTR</th>
                            <th style={{ textAlign: 'right' }}>Cost</th>
                            <th style={{ textAlign: 'right' }}>CPC</th>
                            <th style={{ textAlign: 'right' }}>Conv.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {searchTermRows.map((st, i) => (
                            <tr key={i}>
                              <td className="font-medium" style={{ maxWidth: 280, wordBreak: 'break-word' }}>{st.term}</td>
                              <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                                {st.matchType ? <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '1px 6px', borderRadius: 3, background: 'var(--bg-muted)', color: 'var(--text-muted)' }}>{String(st.matchType).replace('_', ' ')}</span> : '—'}
                              </td>
                              <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{st.impressions.toLocaleString()}</td>
                              <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{st.clicks.toLocaleString()}</td>
                              <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{st.ctr > 0 ? `${(st.ctr * 100).toFixed(2)}%` : '—'}</td>
                              <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtCurrency(st.displaySpend)}</td>
                              <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{st.cpc > 0 ? fmtCurrency(st.cpc) : '—'}</td>
                              <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{st.conversions > 0 ? st.conversions.toFixed(1) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              }

              if (negativeKeywords.length > 0) {
                tabDefs.push({ label: 'Negative Keywords', count: negativeKeywords.length })
                panels.push(
                  <div key="neg" className="space-y-4">
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
                )
              }

              if (tabDefs.length === 0) return null
              return <TabContainer tabs={tabDefs} panels={panels} />
            })()}
          </div>
        ) : (
          /* Meta or Google non-Search: ads table with optional card view toggle for Meta */
          <div className="card p-6">
            <div className="mb-5">
              <h2 className="section-title">{adRows.length} Ad{adRows.length !== 1 ? 's' : ''}</h2>
            </div>
            <AdRowTable
              rows={adRows}
              conversionLabel={conversionLabel}
              showCardView={source === 'meta_ads'}
              tableColumns={adsColumns}
              clientId={client.id}
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

      {/* Images / Logos / Videos — slider with lightbox + broken-image filtering */}
      {(images.length > 0 || logos.length > 0 || videos.length > 0) && (
        <PMaxAssetSlider assets={assets} />
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
