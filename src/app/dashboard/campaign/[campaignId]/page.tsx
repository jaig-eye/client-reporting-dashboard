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
import { AdGroupTable, type AdGroupRow } from '@/components/AdTable'
import SparkMetricCard from '@/components/SparkMetricCard'
import MetricCard from '@/components/MetricCard'
import KeywordTable, { type KeywordRow } from '@/components/KeywordTable'
import DateRangePicker from '@/components/DateRangePicker'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr'
import {
  resolvePaidAdsLayout, resolvePlatformLayout, resolveMetaMediaLayout,
  METRIC_LABELS, type MetricLayouts, type MetricKey,
} from '@/lib/metric-layouts'

export const dynamic = 'force-dynamic'

const META_DEFAULT_NAMES = new Set(['ad set', 'ad', 'new ad set', 'new ad', 'untitled ad set', 'untitled ad'])
function isMetaDefaultName(name: string) {
  return !name.trim() || META_DEFAULT_NAMES.has(name.trim().toLowerCase())
}

function normalizeMetaAdStatus(status: string | null): string | null {
  if (!status) return null
  const s = status.toUpperCase()
  if (s === 'ACTIVE' || s === 'ENABLED') return 'ACTIVE'
  if (s === 'PAUSED' || s === 'CAMPAIGN_PAUSED' || s === 'ADSET_PAUSED') return 'PAUSED'
  return status
}

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
  const rawMode            = cookieStore.get('admin_raw_mode')?.value === '1'
  const effectiveAdFuelCut = rawMode ? 0 : adFuelCut

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
    conversions: number; conversions_value: number; all_conversions_value?: number | null
  }
  type MetaAdRow = {
    ad_id: string; adset_id: string | null; adset_name: string | null; ad_status: string | null; date: string
    adset_daily_budget?: number | null
    spend: number; impressions: number; clicks: number
    conversions: number; conversion_value: number
    actions:      { action_type: string; value: string }[] | null
    action_values: { action_type: string; value: string }[] | null
  }

  let campaignName = decodeURIComponent(campaignId)

  // Map<setId, { setName, status, latestDate, adsetBudget, spend, impressions, clicks, conversions, conversionValue, adIds }>
  type SetAgg = { setName: string; status: string | null; latestDate: string; adsetBudget: number | null; spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number; adIds: Set<string> }
  const setMap = new Map<string, SetAgg>()

  function upsertSet(setId: string, setName: string, adId: string, adStatus: string | null, date: string, sp: number, im: number, cl: number, co: number, cv: number, adsetBudget: number | null = null) {
    const normalized = normalizeMetaAdStatus(adStatus)
    const ex = setMap.get(setId)
    if (ex) {
      ex.spend           += sp
      ex.impressions     += im
      ex.clicks          += cl
      ex.conversions     += co
      ex.conversionValue += cv
      ex.adIds.add(adId)
      // Keep the first non-null adset budget seen (all ads in same adset share same value)
      if (ex.adsetBudget == null && adsetBudget != null) ex.adsetBudget = adsetBudget
      if (date > ex.latestDate) {
        ex.latestDate = date
        // Update name from the most recent row — ad set names can change over time
        if (setName?.trim()) ex.setName = setName.trim()
        // Only update status with a real value; recent rows often have ad_status=null
        // (omitted from upsert payloads) — don't overwrite a known status with null.
        if (normalized !== null) ex.status = normalized
      } else if (date === ex.latestDate) {
        // Same day: prefer ACTIVE over PAUSED; keep existing if new is null
        if (normalized === 'ACTIVE') ex.status = normalized
        else if (normalized !== null && !ex.status) ex.status = normalized
        if (setName?.trim()) ex.setName = setName.trim()
      }
    } else {
      setMap.set(setId, { setName, status: normalized, latestDate: date, adsetBudget, spend: sp, impressions: im, clicks: cl, conversions: co, conversionValue: cv, adIds: new Set([adId]) })
    }
  }

  const priorTotals = { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 }
  let isPMax             = false
  let avgImprShare:      number | null = null
  let priorAvgImprShare: number | null = null
  let campTypeRaw       = ''
  let campaignStartDate: string | null = null

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
    const [{ data: rows }, { data: campRow }, { data: priorRows }, { data: priorIsRows }] = await Promise.all([
      db.from('google_ads_ad_metrics')
        .select('ad_id,ad_group_id,ad_group_name,spend,impressions,clicks,conversions,conversions_value,all_conversions_value,date')
        .eq('client_id', client.id)
        .eq('campaign_id', campaignId)
        .gte('date', dateFrom)
        .lte('date', dateTo),
      db.from('google_ads_metrics')
        .select('campaign_name,campaign_type,search_impression_share,campaign_start_date')
        .eq('client_id', client.id).eq('campaign_id', campaignId)
        .gte('date', dateFrom).lte('date', dateTo),
      showCompare
        ? db.from('google_ads_ad_metrics')
            .select('spend,impressions,clicks,conversions,conversions_value,all_conversions_value')
            .eq('client_id', client.id)
            .eq('campaign_id', campaignId)
            .gte('date', priorFrom)
            .lte('date', priorTo)
        : Promise.resolve({ data: [] as { spend: number; impressions: number; clicks: number; conversions: number; conversions_value: number; all_conversions_value?: number | null }[] }),
      showCompare
        ? db.from('google_ads_metrics')
            .select('search_impression_share')
            .eq('client_id', client.id)
            .eq('campaign_id', campaignId)
            .gte('date', priorFrom)
            .lte('date', priorTo)
        : Promise.resolve({ data: [] as { search_impression_share: number | null }[] }),
    ])
    const campRows = (campRow as { campaign_name: string; campaign_type: string | null; search_impression_share: number | null; campaign_start_date?: string | null; date?: string }[] | null) ?? []
    // Sort desc by date so the most-recent row's name/type is used — not the oldest
    const sortedRows = [...campRows].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    const firstCamp  = sortedRows[0] ?? null
    if (firstCamp) campaignName = firstCamp.campaign_name
    isPMax = firstCamp?.campaign_type === 'PERFORMANCE_MAX'
      || campaignName.toLowerCase().startsWith('pmax')
    // Average impression share across the period (null if none available)
    const isRows = campRows.filter(r => r.search_impression_share !== null)
    avgImprShare = isRows.length > 0 ? isRows.reduce((s, r) => s + (r.search_impression_share ?? 0), 0) / isRows.length : null
    // Prior period impression share for delta
    const priorIsFiltered = (priorIsRows ?? []).filter(r => r.search_impression_share !== null)
    priorAvgImprShare = priorIsFiltered.length > 0
      ? priorIsFiltered.reduce((s, r) => s + (r.search_impression_share ?? 0), 0) / priorIsFiltered.length
      : null
    campTypeRaw       = (firstCamp?.campaign_type ?? '').toUpperCase()
    campaignStartDate = firstCamp?.campaign_start_date ?? null
    for (const r of (rows ?? []) as GoogleAdRow[]) {
      const sp = Number(r.spend)||0, im = Number(r.impressions)||0, cl = Number(r.clicks)||0
      const co = Number(r.conversions)||0
      const cv = Number(r.conversions_value) || 0
      upsertSet(r.ad_group_id, r.ad_group_name, r.ad_id, null, r.date, sp, im, cl, co, cv)
      upsertDay(r.date, sp, im, cl, co, cv)
    }
    for (const r of (priorRows ?? []) as { spend: number; impressions: number; clicks: number; conversions: number; conversions_value: number; all_conversions_value?: number | null }[]) {
      priorTotals.spend           += Number(r.spend)            || 0
      priorTotals.impressions     += Number(r.impressions)      || 0
      priorTotals.clicks          += Number(r.clicks)           || 0
      priorTotals.conversions     += Number(r.conversions)      || 0
      priorTotals.conversionValue += Number(r.conversions_value) || 0
    }
  } else {
    // Fetch campaign-level rows for KPI totals/sparklines (matches dashboard source)
    // and ad-level rows separately for the adset breakdown table.
    type MetaCampRow = {
      campaign_name: string; date: string
      spend: number; impressions: number; clicks: number
      conversions: number; conversion_value: number
      actions: { action_type: string; value: string }[] | null
      action_values: { action_type: string; value: string }[] | null
    }
    const [{ data: campRows }, { data: rows }, { data: priorCampRows }, { data: priorRows }, { data: adsetMetaRows }] = await Promise.all([
      db.from('meta_ads_metrics')
        .select('campaign_name,campaign_created_at,date,spend,impressions,clicks,conversions,conversion_value,actions,action_values')
        .eq('client_id', client.id)
        .eq('campaign_id', campaignId)
        .gte('date', dateFrom)
        .lte('date', dateTo),
      db.from('meta_ads_ad_metrics')
        .select('ad_id,adset_id,adset_name,ad_status,adset_daily_budget,spend,impressions,clicks,conversions,conversion_value,actions,action_values,date')
        .eq('client_id', client.id)
        .eq('campaign_id', campaignId)
        .gte('date', dateFrom)
        .lte('date', dateTo),
      showCompare
        ? db.from('meta_ads_metrics')
            .select('spend,impressions,clicks,conversions,conversion_value,actions,action_values')
            .eq('client_id', client.id)
            .eq('campaign_id', campaignId)
            .gte('date', priorFrom)
            .lte('date', priorTo)
        : Promise.resolve({ data: [] as MetaCampRow[] }),
      showCompare
        ? db.from('meta_ads_ad_metrics')
            .select('ad_id,adset_id,adset_name,spend,impressions,clicks,conversions,conversion_value,actions,action_values,date')
            .eq('client_id', client.id)
            .eq('campaign_id', campaignId)
            .gte('date', priorFrom)
            .lte('date', priorTo)
        : Promise.resolve({ data: [] as MetaAdRow[] }),
      // Current adset metadata — bounded to 90 days (same window as adset detail metaQ).
      // Adsets deleted/renamed >90 days ago stop receiving sync rows and won't appear,
      // preventing ghost zero-metric entries from stale historical data.
      db.from('meta_ads_ad_metrics')
        .select('adset_id,adset_name,ad_status,adset_daily_budget')
        .eq('client_id', client.id)
        .eq('campaign_id', campaignId)
        .gte('date', (() => { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().split('T')[0] })())
        .order('date', { ascending: false })
        .limit(1000),
    ])
    if ((campRows ?? []).length > 0) {
      // Sort desc by date so we always use the current name, not an old one from the range
      const sortedMeta = [...(campRows as (MetaCampRow & { campaign_created_at?: string | null })[])].sort(
        (a, b) => ((b as { date?: string }).date ?? '').localeCompare((a as { date?: string }).date ?? '')
      )
      const firstMeta = sortedMeta.find(r => r.campaign_name)
      if (firstMeta) {
        campaignName = firstMeta.campaign_name
        campaignStartDate = firstMeta.campaign_created_at ?? null
      }
    }
    // Campaign-level rows → KPI totals + sparklines
    for (const r of (campRows ?? []) as MetaCampRow[]) {
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
      upsertDay(r.date, sp, im, cl, co, cv)
    }
    // Ad-level rows → adset breakdown table only
    for (const r of (rows ?? []) as MetaAdRow[]) {
      // Skip adset-level summary rows (ad_id = adset_id) — Meta's sync stores one aggregate
      // row per adset per day alongside the per-ad rows. Including it would double the spend.
      if (r.adset_id && r.ad_id === r.adset_id) continue
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
      // Use a human-readable fallback when adset_name is missing (common for paused
      // campaigns). Purely numeric names get filtered out downstream, so we need
      // something that won't be caught by the /^\d+$/ guard.
      const adsetDisplayName = (r.adset_name && r.adset_name.trim())
        ? r.adset_name.trim()
        : (r.adset_id ? `Ad Set ${String(r.adset_id).slice(-6)}` : 'Unknown Ad Set')
      upsertSet(setId, adsetDisplayName, r.ad_id, r.ad_status ?? null, r.date, sp, im, cl, co, cv, r.adset_daily_budget ?? null)
    }
    // Prior period: campaign-level for compare deltas
    for (const r of (priorCampRows ?? []) as MetaCampRow[]) {
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
    // Suppress unused warning — priorRows kept for potential future ad-level compare
    void priorRows

    // Override setMap name and status with current metadata (no date filter).
    // This ensures ad sets that had no activity in the selected range still appear,
    // and that names/statuses always reflect the current state regardless of date range.
    type AdsetMetaRow = { adset_id: string | null; adset_name: string | null; ad_status: string | null; adset_daily_budget?: number | null }
    const currentAdsetMeta = new Map<string, { name: string; status: string | null; budget: number | null }>()
    for (const r of (adsetMetaRows ?? []) as AdsetMetaRow[]) {
      // Use adset_name as canonical key — matches the setMap keys from per-ad rows (which
      // have adset_id=NULL). This prevents the numeric-id vs name key mismatch that caused
      // the status override to target the wrong setMap entry.
      const sid = r.adset_name ?? r.adset_id ?? ''
      if (!sid) continue
      const ex = currentAdsetMeta.get(sid)
      if (!ex) {
        // First row per adset (ordered by date desc) is the most recent — capture name,
        // status, and budget. Status/budget may be null if the upsert omitted them.
        currentAdsetMeta.set(sid, {
          name:   r.adset_name ?? '',
          status: r.ad_status != null ? normalizeMetaAdStatus(r.ad_status) : null,
          budget: r.adset_daily_budget ?? null,
        })
      } else {
        // Keep scanning to fill in any null values from more-recent rows
        if (ex.status === null && r.ad_status != null) {
          ex.status = normalizeMetaAdStatus(r.ad_status)
        }
        if (ex.budget === null && r.adset_daily_budget != null) {
          ex.budget = r.adset_daily_budget
        }
      }
    }
    // Apply current metadata to existing setMap entries AND surface any adsets
    // that have current rows but zero metrics in the selected date range.
    //
    // Key-mismatch handling: Meta's sync stores an adset-level summary row with
    // ad_id = adset_id. In adsetMetaRows, that row's sid = adset_id (numeric). But in
    // setMap, the same adset's key may be adset_name (because the per-ad rows have
    // adset_id=NULL). When the keys differ we fall back to a name-based lookup so the
    // correct current status is always applied to the right setMap entry.
    for (const [sid, meta] of Array.from(currentAdsetMeta)) {
      if (setMap.has(sid)) {
        // Direct key match — update name/status/budget from current data
        const ex = setMap.get(sid)!
        if (meta.name)           ex.setName    = meta.name
        if (meta.status != null) ex.status     = meta.status
        if (meta.budget != null) ex.adsetBudget = meta.budget  // raw; applyAdFuel applied once in adGroups
      } else if (meta.name && !isMetaDefaultName(meta.name)) {
        // No direct key match. Try to find an existing setMap entry by name
        // (handles the case where setMap key = adset_name but currentAdsetMeta key = adset_id).
        let matchByName: SetAgg | undefined
        for (const v of Array.from(setMap.values())) {
          if (v.setName.toLowerCase() === meta.name.toLowerCase()) { matchByName = v; break }
        }
        if (matchByName) {
          // Found the same adset under a different key — update status and budget
          if (meta.status != null) matchByName.status = meta.status
          if (meta.budget != null) matchByName.adsetBudget = meta.budget  // raw; markup in adGroups
        } else {
          // Truly new adset — had no activity in the date range → add with zero metrics
          setMap.set(sid, {
            setName: meta.name, status: meta.status, adsetBudget: meta.budget ?? null,  // raw
            latestDate: '', spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0,
            adIds: new Set(),
          })
        }
      }
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
    const dSpend = effectiveAdFuelCut > 0 ? applyAdFuel(k.spend, effectiveAdFuelCut) : k.spend
    return { keyword_text: k.text, match_type: k.matchType, keyword_status: k.status, impressions: k.impressions, clicks: k.clicks, conversions: k.conversions, spend: k.spend, displaySpend: dSpend, ctr: k.impressions > 0 ? k.clicks / k.impressions : 0, cpc: k.clicks > 0 ? dSpend / k.clicks : 0, cpl: k.conversions > 0 ? dSpend / k.conversions : 0 }
  }).sort((a, b) => b.impressions - a.impressions)

  // Search terms are shown at the ad group level (adset page), not campaign level

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
      const cost    = effectiveAdFuelCut > 0 ? applyAdFuel(s.spend, effectiveAdFuelCut) : s.spend
      return {
        setId,
        setName:         s.setName,
        status:          s.status ?? null,
        spend:           cost,
        impressions:     s.impressions,
        clicks:          s.clicks,
        conversions:     s.conversions,
        conversionValue: s.conversionValue,
        adCount:         s.adIds.size,
        adsetBudget:     s.adsetBudget != null ? (effectiveAdFuelCut > 0 ? applyAdFuel(s.adsetBudget, effectiveAdFuelCut) : s.adsetBudget) : null,
        cpl:             s.conversions > 0 ? cost / s.conversions : 0,
        ctr:             s.impressions > 0 ? s.clicks / s.impressions : 0,
        convRate:        s.clicks > 0 ? s.conversions / s.clicks : 0,
        cpc:             s.clicks > 0 ? cost / s.clicks : 0,
        cpm:             s.impressions > 0 ? (cost / s.impressions) * 1000 : 0,
        roas:            cost > 0 && s.conversionValue > 0 ? s.conversionValue / cost : 0,
        revenue:         s.conversionValue,
        href:            `/dashboard/campaign/${encodeURIComponent(campaignId)}/adset/${encodeURIComponent(setId)}?${adsetQs}`,
      }
    })
    .filter(g => !isMetaDefaultName(g.setName))
    // Merge entries with the same name (handles null adset_id rows creating duplicate buckets)
    .reduce((acc: AdGroupRow[], g: AdGroupRow) => {
      const existing = acc.find((x: AdGroupRow) => x.setName.toLowerCase() === g.setName.toLowerCase())
      if (existing) {
        existing.spend           += g.spend
        existing.impressions     += g.impressions
        existing.clicks          += g.clicks
        existing.conversions     += g.conversions
        existing.conversionValue += g.conversionValue
        existing.adCount         += g.adCount
        existing.cpl      = existing.conversions > 0 ? existing.spend / existing.conversions : 0
        existing.ctr      = existing.impressions > 0 ? existing.clicks / existing.impressions : 0
        existing.convRate = existing.clicks > 0 ? existing.conversions / existing.clicks : 0
        existing.cpc      = existing.clicks > 0 ? existing.spend / existing.clicks : 0
        existing.cpm      = existing.impressions > 0 ? (existing.spend / existing.impressions) * 1000 : 0
        existing.roas     = existing.spend > 0 && existing.conversionValue > 0 ? existing.conversionValue / existing.spend : 0
        existing.revenue  = existing.conversionValue
        if (!existing.status && g.status) existing.status = g.status
        // Keep the first non-null adset budget — both entries represent the same adset
        if (existing.adsetBudget == null && g.adsetBudget != null) existing.adsetBudget = g.adsetBudget
      } else {
        acc.push(g)
      }
      return acc
    }, [] as AdGroupRow[])
    .filter((g: AdGroupRow) => !/^\d+$/.test(g.setName))
    .sort((a, b) => b.spend - a.spend)

  // KPI totals: prefer ad-level data (adGroups) as the source of truth — it matches
  // the ad set breakdown table. Fall back to dailyMap only when no ad-level data exists.
  let totSpend = 0, totImpressions = 0, totClicks = 0, totConversions = 0, totConversionValue = 0
  if (adGroups.length > 0) {
    totSpend           = adGroups.reduce((t, s) => t + s.spend, 0)
    totImpressions     = adGroups.reduce((t, s) => t + s.impressions, 0)
    totClicks          = adGroups.reduce((t, s) => t + s.clicks, 0)
    totConversions     = adGroups.reduce((t, s) => t + s.conversions, 0)
    totConversionValue = adGroups.reduce((t, s) => t + s.conversionValue, 0)
  } else if (dailyMap.size > 0) {
    for (const v of Array.from(dailyMap.values())) {
      totSpend           += effectiveAdFuelCut > 0 ? applyAdFuel(v.spend, effectiveAdFuelCut) : v.spend
      totImpressions     += v.impressions
      totClicks          += v.clicks
      totConversions     += v.conversions
      totConversionValue += v.conversionValue
    }
  }

  // KPI derived values (totSpend is already after markup)
  const displaySpend      = totSpend
  const roas              = displaySpend > 0 && totConversionValue > 0 ? totConversionValue / displaySpend : 0
  const cpl               = totConversions > 0 ? displaySpend / totConversions : 0
  const ctr               = totImpressions > 0 ? totClicks / totImpressions : 0
  const priorDisplaySpend = effectiveAdFuelCut > 0 ? applyAdFuel(priorTotals.spend, effectiveAdFuelCut) : priorTotals.spend
  const priorRoas         = priorDisplaySpend > 0 && priorTotals.conversionValue > 0 ? priorTotals.conversionValue / priorDisplaySpend : 0
  const priorCpl          = priorTotals.conversions > 0 ? priorDisplaySpend / priorTotals.conversions : 0
  const priorCtr          = priorTotals.impressions > 0 ? priorTotals.clicks / priorTotals.impressions : 0

  // Sparkline series from daily aggregation
  const sortedDays = Array.from(dailyMap.entries()).sort(([a], [b]) => a.localeCompare(b))
  const spendSeries = sortedDays.map(([, v]) => ({ v: effectiveAdFuelCut > 0 ? applyAdFuel(v.spend, effectiveAdFuelCut) : v.spend }))
  const convSeries  = sortedDays.map(([, v]) => ({ v: v.conversions }))
  const cvSeries    = sortedDays.map(([, v]) => ({ v: v.conversionValue }))
  const cplSeries   = sortedDays.map(([, v]) => {
    const ds = effectiveAdFuelCut > 0 ? applyAdFuel(v.spend, effectiveAdFuelCut) : v.spend
    return { v: v.conversions > 0 ? ds / v.conversions : 0 }
  })
  const ctrSeries   = sortedDays.map(([, v]) => ({ v: v.impressions > 0 ? v.clicks / v.impressions : 0 }))
  const clicksSeries = sortedDays.map(([, v]) => ({ v: v.clicks }))

  // ── Layout resolution ─────────────────────────────────────────────────────
  const isGoogleSearch = isGoogleAds && !isPMax && campTypeRaw.includes('SEARCH')
  const isGoogleShop   = isGoogleAds && (isPMax || campTypeRaw.includes('SHOPPING'))

  const agencyLayouts  = settings.metric_layouts as MetricLayouts | null | undefined
  const clientOverride = client.metric_layout_override as MetricLayouts | null | undefined
  const isMetaMedia    = source === 'meta_ads' && (displayMode === 'awareness' || displayMode === 'engagement')
  const campaignLayout = isGoogleSearch
    ? resolvePlatformLayout(agencyLayouts, clientOverride, 'google_search')
    : isGoogleShop
    ? resolvePlatformLayout(agencyLayouts, clientOverride, 'google_shopping')
    : isMetaMedia
    ? resolveMetaMediaLayout(agencyLayouts, clientOverride, isEcom)
    : resolvePaidAdsLayout(agencyLayouts, clientOverride, isEcom)

  const adgroupColumns: string[] | undefined = 'adgroup_table_columns' in campaignLayout
    ? (campaignLayout as { adgroup_table_columns?: string[] }).adgroup_table_columns
    : undefined

  // ── Metric value / spark / delta maps ─────────────────────────────────────
  const invertDeltaKeys = new Set(['spend', 'cpa', 'cpl', 'cpm', 'cpc'])

  const cpmSeries  = sortedDays.map(([, v]) => { const ds = effectiveAdFuelCut > 0 ? applyAdFuel(v.spend, effectiveAdFuelCut) : v.spend; return { v: v.impressions > 0 ? (ds / v.impressions) * 1000 : 0 } })
  const cpcSeries  = sortedDays.map(([, v]) => { const ds = effectiveAdFuelCut > 0 ? applyAdFuel(v.spend, effectiveAdFuelCut) : v.spend; return { v: v.clicks > 0 ? ds / v.clicks : 0 } })
  const crSeries   = sortedDays.map(([, v]) => ({ v: v.clicks > 0 ? v.conversions / v.clicks : 0 }))
  const roasSeries = sortedDays.map(([, v]) => { const ds = effectiveAdFuelCut > 0 ? applyAdFuel(v.spend, effectiveAdFuelCut) : v.spend; return { v: ds > 0 && v.conversionValue > 0 ? v.conversionValue / ds : 0 } })

  const campaignValMap: Record<string, string> = {
    spend:            fmt$(displaySpend),
    leads:            totConversions > 0     ? fmtNum(totConversions)        : '—',
    conversions:      totConversions > 0     ? fmtNum(totConversions)        : '—',
    revenue:          totConversionValue > 0 ? fmt$(totConversionValue)      : '—',
    roas:             roas > 0               ? fmtRoas(roas)                 : '—',
    cpa:              cpl > 0               ? fmtCurrency(cpl)              : '—',
    ctr:              fmtPct(ctr),
    impression_share: avgImprShare != null   ? `${(avgImprShare * 100).toFixed(1)}%` : '—',
    clicks:           fmtNum(totClicks),
    impressions:      fmtNum(totImpressions),
    cpm:              totImpressions > 0     ? fmtCurrency((displaySpend / totImpressions) * 1000) : '—',
    cpc:              totClicks > 0          ? fmtCurrency(displaySpend / totClicks) : '—',
    conv_rate:        totClicks > 0          ? fmtPct(totConversions / totClicks) : '—',
  }
  const campaignCurrNum: Record<string, number> = {
    spend: displaySpend, leads: totConversions, conversions: totConversions,
    revenue: totConversionValue, roas, cpa: cpl, ctr,
    impression_share: avgImprShare ?? 0, clicks: totClicks, impressions: totImpressions,
    cpm: totImpressions > 0 ? (displaySpend / totImpressions) * 1000 : 0,
    cpc: totClicks > 0 ? displaySpend / totClicks : 0,
    conv_rate: totClicks > 0 ? totConversions / totClicks : 0,
  }
  const campaignPriorNum: Record<string, number> = {
    spend: priorDisplaySpend, leads: priorTotals.conversions, conversions: priorTotals.conversions,
    revenue: priorTotals.conversionValue, roas: priorRoas, cpa: priorCpl, ctr: priorCtr,
    clicks: priorTotals.clicks, impressions: priorTotals.impressions,
    cpm: priorTotals.impressions > 0 ? (priorDisplaySpend / priorTotals.impressions) * 1000 : 0,
    cpc: priorTotals.clicks > 0 ? priorDisplaySpend / priorTotals.clicks : 0,
    conv_rate: priorTotals.clicks > 0 ? priorTotals.conversions / priorTotals.clicks : 0,
    impression_share: priorAvgImprShare ?? 0,
  }
  const campaignSparkMap: Record<string, { v: number }[]> = {
    spend: spendSeries, leads: convSeries, conversions: convSeries, revenue: cvSeries,
    roas: roasSeries, cpa: cplSeries, ctr: ctrSeries, clicks: clicksSeries,
    impressions: sortedDays.map(([, v]) => ({ v: v.impressions })),
    cpm: cpmSeries, cpc: cpcSeries, conv_rate: crSeries, impression_share: [],
  }
  const sparkColorMap: Record<string, string> = {
    spend: 'var(--blue)', roas: 'var(--green)', revenue: 'var(--green)',
    leads: 'var(--green)', conversions: 'var(--green)', cpa: '#f59e0b',
    ctr: 'var(--blue)', clicks: '#8b5cf6', impressions: 'var(--text-muted)',
    cpm: '#f59e0b', cpc: '#f59e0b', conv_rate: 'var(--green)', impression_share: '#6366f1',
  }
  function getMetricLabel(key: string): string {
    if (key === 'conversions' || key === 'leads') return conversionLabel
    return METRIC_LABELS[key as MetricKey] ?? key
  }

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
                {campaignStartDate && (
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    Started {new Date(campaignStartDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                )}
                <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  {dateFrom} – {dateTo}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Campaign KPI summary (layout-driven) ───────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {campaignLayout.kpi_cards.map((key, i) => (
            <SparkMetricCard
              key={key}
              label={getMetricLabel(key)}
              value={campaignValMap[key] ?? '—'}
              delta={showCompare && campaignCurrNum[key] !== undefined
                ? calcDelta(campaignCurrNum[key] ?? 0, campaignPriorNum[key] ?? 0)
                : undefined}
              invertDelta={invertDeltaKeys.has(key)}
              sparkData={campaignSparkMap[key] ?? []}
              sparkColor={sparkColorMap[key] ?? 'var(--blue)'}
              delay={i}
            />
          ))}
        </div>

        {/* ── Top metrics row (layout-driven, no sparklines) ──────── */}
        {campaignLayout.top_metrics.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {campaignLayout.top_metrics.map((key, i) => (
              <MetricCard
                key={key}
                label={getMetricLabel(key)}
                value={campaignValMap[key] ?? '—'}
                delta={showCompare && campaignCurrNum[key] !== undefined
                  ? calcDelta(campaignCurrNum[key] ?? 0, campaignPriorNum[key] ?? 0)
                  : undefined}
                invertDelta={invertDeltaKeys.has(key)}
                delay={campaignLayout.kpi_cards.length + i}
              />
            ))}
          </div>
        )}

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
            tableColumns={adgroupColumns}
          />
        </div>

      </main>
    </div>
  )
}
