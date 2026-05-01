// /api/export/report
// Generates a professional performance report in two formats:
//   ?format=pdf   → Print-optimised HTML, opens in browser tab (Ctrl+P → Save as PDF)
//   ?format=email → Table-based HTML email download (.html file, compatible with Gmail/Outlook)
// Both respect the client's hiddenMetrics and adFuelCut settings.

import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { getAgencySettings } from '@/lib/agency-settings'
import {
  summarizeMetrics, calcDelta,
  fmt$, fmtNum, fmtPct, fmtCurrency, fmtRoas,
  applyAdFuel, resolveMetaConversions,
} from '@/lib/metrics'
import type { Client, ClientConnection, Connector, MetaAction } from '@/lib/types'

export const dynamic = 'force-dynamic'

function fmtDate(d: Date) { return d.toISOString().split('T')[0] }
function fmtDateLabel(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Data types ───────────────────────────────────────────────────────────────

interface CampaignRow {
  name: string; source: string; spend: number
  conversions: number; conversionValue: number
  ctr: number; cpl: number; impressions: number; clicks: number
  status?: string | null
}

interface ReportData {
  agencyName: string
  agencyLogoUrl: string | null
  clientName: string
  clientLogoUrl: string | null
  fromDate: Date
  toDate: Date
  priorFrom: Date
  priorTo: Date
  showCompare: boolean
  isEcomDash: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  current: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prior: any
  convRate: number
  priorConvRate: number
  campaigns: CampaignRow[]
  syncedAt: string | null
  generatedAt: string
  crmName: string
  ga4: { sessions: number; users: number; newUsers: number; avgDuration: number } | null
  ghl: { contacts: number; calls: number; forms: number; emailsSent: number; smsSent: number } | null
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const url     = new URL(req.url)
  const format  = url.searchParams.get('format') ?? 'pdf'
  const fromParam   = url.searchParams.get('from')
  const toParam     = url.searchParams.get('to')
  // Default to prev_period so reports always show MoM deltas
  const compareParam = url.searchParams.get('compare') ?? 'prev_period'

  const cookieStore = await cookies()
  const token = cookieStore.get('client_token')?.value
  if (!token) return new Response('Unauthorized', { status: 401 })

  const db = createAdminClient()

  const [clientResult, settings] = await Promise.all([
    db.from('clients').select('*').eq('dashboard_token', token).single(),
    getAgencySettings(),
  ])

  const client = clientResult.data as Client | null
  if (!client) return new Response('Unauthorized', { status: 401 })

  const toDate   = toParam   ? new Date(toParam)   : new Date()
  const fromDate = fromParam ? new Date(fromParam)  : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const compare  = compareParam
  const showCompare = compare !== 'none'

  const periodMs = toDate.getTime() - fromDate.getTime()
  let priorTo: Date, priorFrom: Date
  if (compare === 'last_year') {
    priorFrom = new Date(fromDate); priorFrom.setFullYear(priorFrom.getFullYear() - 1)
    priorTo   = new Date(toDate);   priorTo.setFullYear(priorTo.getFullYear() - 1)
  } else {
    priorTo   = new Date(fromDate.getTime() - 86400000)
    priorFrom = new Date(priorTo.getTime() - periodMs)
  }

  // Fetch connections and campaign assignments
  const { data: connData } = await db
    .from('client_connections')
    .select('*, connector:connectors(id, type, label)')
    .eq('client_id', client.id)
    .eq('status', 'active')

  const connections = (connData ?? []) as (ClientConnection & { connector: Pick<Connector, 'id' | 'type' | 'label'> })[]
  const availableSources  = connections.map(c => c.connector.type)
  const hiddenConnectors  = new Set((settings.hidden_connector_types as string[] | undefined) ?? [])
  const hasGoogle = availableSources.includes('google_ads')
  const hasMeta   = availableSources.includes('meta_ads')
  const hasGA4    = availableSources.includes('google_analytics') && !hiddenConnectors.has('google_analytics')
  const hasGHL    = availableSources.includes('ghl') && !hiddenConnectors.has('ghl')
  const adFuelCut = client.ad_fuel_cut != null ? client.ad_fuel_cut : settings.ad_fuel_cut
  const hiddenMetrics = new Set(client.hidden_metrics ?? [])

  const activeConnection = connections.reduce<typeof connections[0] | undefined>(
    (best, c) => (!best || (c.last_synced_at ?? '') > (best.last_synced_at ?? '')) ? c : best,
    undefined
  )

  const [gRes, mRes, gPriorRes, mPriorRes, gAssignRes, mAssignRes, ga4Res, ghlRes] = await Promise.all([
    hasGoogle
      ? db.from('google_ads_metrics').select('*').eq('client_id', client.id)
          .gte('date', fmtDate(fromDate)).lte('date', fmtDate(toDate))
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    hasMeta
      ? db.from('meta_ads_metrics').select('*').eq('client_id', client.id)
          .gte('date', fmtDate(fromDate)).lte('date', fmtDate(toDate))
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    showCompare && hasGoogle
      ? db.from('google_ads_ad_metrics')
          .select('campaign_id,spend,impressions,clicks,conversions,conversions_value,date')
          .eq('client_id', client.id)
          .gte('date', fmtDate(priorFrom)).lte('date', fmtDate(priorTo))
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    showCompare && hasMeta
      ? db.from('meta_ads_ad_metrics')
          .select('campaign_id,spend,impressions,clicks,conversions,conversion_value,actions,action_values,date')
          .eq('client_id', client.id)
          .gte('date', fmtDate(priorFrom)).lte('date', fmtDate(priorTo))
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    hasGoogle
      ? db.from('client_campaign_assignments').select('campaign_id,display_mode,hidden')
          .eq('client_id', client.id).eq('source', 'google_ads')
      : Promise.resolve({ data: [] as { campaign_id: string; display_mode: string; hidden: boolean }[] }),
    hasMeta
      ? db.from('client_campaign_assignments').select('campaign_id,display_mode,hidden')
          .eq('client_id', client.id).eq('source', 'meta_ads')
      : Promise.resolve({ data: [] as { campaign_id: string; display_mode: string; hidden: boolean }[] }),
    hasGA4
      ? db.from('ga4_metrics').select('sessions, users, new_users, avg_session_duration')
          .eq('client_id', client.id)
          .is('channel_group', null)
          .gte('date', fmtDate(fromDate)).lte('date', fmtDate(toDate))
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    hasGHL
      ? db.from('ghl_metrics').select('contacts_created, total_calls, forms_submitted, emails_sent, sms_sent')
          .eq('client_id', client.id)
          .gte('date', fmtDate(fromDate)).lte('date', fmtDate(toDate))
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ])

  const assignmentsData = [
    ...((gAssignRes.data ?? []) as { campaign_id: string; display_mode: string; hidden: boolean }[]),
    ...((mAssignRes.data ?? []) as { campaign_id: string; display_mode: string; hidden: boolean }[]),
  ]
  const assignmentMap = new Map(assignmentsData.map(a => [a.campaign_id, a]))
  const ecomCount  = assignmentsData.filter(a => a.display_mode === 'ecommerce').length
  const leadCount  = assignmentsData.filter(a => a.display_mode !== 'ecommerce').length
  const isEcomDash = ecomCount > leadCount

  type NormRow = {
    campaign_id: string; campaign_name: string; date: string; _source: string
    campaign_status?: string | null
    spend: number; impressions: number; clicks: number
    conversions: number; conversion_value: number
  }

  function normalise(rows: Record<string, unknown>[], source: string): NormRow[] {
    return rows.map(m => {
      let conversions = Number(m.conversions) || 0
      let conversion_value = Number(m.conversion_value ?? m.conversions_value ?? 0)
      if (Array.isArray(m.actions)) {
        const isEcom = (assignmentMap.get(String(m.campaign_id || ''))?.display_mode ?? 'lead_gen') === 'ecommerce'
        const primary = isEcom
          ? (client!.purchase_action ?? settings.default_purchase_action ?? 'purchase')
          : (client!.lead_action ?? settings.default_lead_action ?? 'onsite_conversion.lead_grouped')
        const fallback = isEcom
          ? (client!.purchase_action_fallback ?? settings.default_purchase_action_fallback ?? null)
          : (client!.lead_action_fallback ?? settings.default_lead_action_fallback ?? 'lead')
        const resolved = resolveMetaConversions(
          m.actions as MetaAction[], (m.action_values as MetaAction[] | null) ?? [], primary, fallback
        )
        conversions = resolved.conversions
        conversion_value = resolved.conversionValue
      }
      return {
        campaign_id:     String(m.campaign_id   || ''),
        campaign_name:   String(m.campaign_name || ''),
        campaign_status: (m.campaign_status as string | null) ?? null,
        _source:         source,
        date:            String(m.date          || ''),
        spend:           Number(m.spend)         || 0,
        impressions:     Number(m.impressions)   || 0,
        clicks:          Number(m.clicks)        || 0,
        conversions, conversion_value,
      }
    })
  }

  const currentMetrics = [
    ...normalise((gRes.data  ?? []) as Record<string, unknown>[], 'google_ads'),
    ...normalise((mRes.data  ?? []) as Record<string, unknown>[], 'meta_ads'),
  ]
  const priorMetrics = [
    ...normalise((gPriorRes.data ?? []) as Record<string, unknown>[], 'google_ads'),
    ...normalise((mPriorRes.data ?? []) as Record<string, unknown>[], 'meta_ads'),
  ]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const current = summarizeMetrics(currentMetrics as any[])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prior   = showCompare ? summarizeMetrics(priorMetrics as any[]) : null
  const convRate = current.clicks > 0 ? current.conversions / current.clicks : 0
  const priorConvRate = prior && prior.clicks > 0 ? prior.conversions / prior.clicks : 0

  // Build campaign list (top 25 by spend)
  const campMap = new Map<string, { name: string; source: string; spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number; status?: string | null }>()
  for (const row of currentMetrics) {
    const assignment = assignmentMap.get(row.campaign_id)
    if (assignment?.hidden) continue
    const ex = campMap.get(row.campaign_id)
    if (ex) {
      ex.spend += row.spend; ex.impressions += row.impressions; ex.clicks += row.clicks
      ex.conversions += row.conversions; ex.conversionValue += row.conversion_value
    } else {
      campMap.set(row.campaign_id, { name: row.campaign_name, source: row._source, spend: row.spend, impressions: row.impressions, clicks: row.clicks, conversions: row.conversions, conversionValue: row.conversion_value, status: row.campaign_status })
    }
  }

  const campaigns: CampaignRow[] = Array.from(campMap.values())
    .map(c => {
      const spend = adFuelCut > 0 ? applyAdFuel(c.spend, adFuelCut) : c.spend
      return { name: c.name, source: c.source, spend, impressions: c.impressions, clicks: c.clicks, conversions: c.conversions, conversionValue: c.conversionValue, ctr: c.impressions > 0 ? c.clicks / c.impressions : 0, cpl: c.conversions > 0 ? spend / c.conversions : 0, status: c.status }
    })
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 25)

  const syncedAt = activeConnection?.last_synced_at
    ? new Date(activeConnection.last_synced_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  // Process GA4 data
  type GA4Row = { sessions: number; users: number; new_users: number; avg_session_duration: number }
  const ga4Rows = (ga4Res.data ?? []) as GA4Row[]
  const ga4Data = ga4Rows.length > 0 ? {
    sessions:    ga4Rows.reduce((s, r) => s + (Number(r.sessions) || 0), 0),
    users:       ga4Rows.reduce((s, r) => s + (Number(r.users) || 0), 0),
    newUsers:    ga4Rows.reduce((s, r) => s + (Number(r.new_users) || 0), 0),
    avgDuration: ga4Rows.reduce((s, r) => s + (Number(r.avg_session_duration) || 0), 0) / ga4Rows.length,
  } : null

  // Process GHL data
  type GHLRow = { contacts_created: number; total_calls: number; forms_submitted: number; emails_sent: number; sms_sent: number }
  const ghlRows = (ghlRes.data ?? []) as GHLRow[]
  const ghlData = ghlRows.length > 0 ? {
    contacts:   ghlRows.reduce((s, r) => s + (Number(r.contacts_created) || 0), 0),
    calls:      ghlRows.reduce((s, r) => s + (Number(r.total_calls) || 0), 0),
    forms:      ghlRows.reduce((s, r) => s + (Number(r.forms_submitted) || 0), 0),
    emailsSent: ghlRows.reduce((s, r) => s + (Number(r.emails_sent) || 0), 0),
    smsSent:    ghlRows.reduce((s, r) => s + (Number(r.sms_sent) || 0), 0),
  } : null

  const data: ReportData = {
    agencyName:    settings.agency_name ?? 'Your Agency',
    agencyLogoUrl: settings.agency_logo_url ?? null,
    clientName:    client.name,
    clientLogoUrl: client.logo_url ?? null,
    fromDate, toDate, priorFrom, priorTo,
    showCompare, isEcomDash,
    current: { ...current, spend: adFuelCut > 0 ? applyAdFuel(current.spend, adFuelCut) : current.spend },
    prior,
    convRate, priorConvRate,
    campaigns,
    syncedAt,
    generatedAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    crmName: (settings.crm_name as string | undefined) ?? 'GoHighLevel',
    ga4: ga4Data,
    ghl: ghlData,
  }

  // ─── Route to correct template ──────────────────────────────────────────
  const safeClientName = client.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()

  if (format === 'email') {
    return new Response(generateEmailHtml(data, hiddenMetrics), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="${safeClientName}-report-email.html"`,
      },
    })
  }

  // PDF / Print: open in new tab, auto-print dialog
  return new Response(generatePrintHtml(data, hiddenMetrics), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Print / PDF HTML
// ─────────────────────────────────────────────────────────────────────────────

function generatePrintHtml(d: ReportData, hidden: Set<string>): string {
  const spend = d.current.spend

  function deltaHtml(val: number, prev: number | null | undefined, invert = false) {
    if (prev == null || !d.showCompare) return ''
    const pct = calcDelta(val, prev)
    if (pct == null) return ''
    const positive = invert ? pct < 0 : pct > 0
    const color = positive ? '#16a34a' : '#dc2626'
    const arrow = pct > 0 ? '▲' : '▼'
    return `<div style="font-size:0.7rem;font-weight:600;color:${color};margin-top:4px;">${arrow} ${Math.abs(pct).toFixed(1)}%</div>`
  }

  const kpiCards = [
    !hidden.has('spend') && { label: 'Total Cost',   value: fmt$(spend),   delta: deltaHtml(spend, d.prior?.spend, true),  accent: '#2563eb' },
    !hidden.has('leads') && (d.isEcomDash
      ? { label: 'Revenue',        value: fmt$(d.current.conversionValue),  delta: deltaHtml(d.current.conversionValue, d.prior?.conversionValue), accent: '#10b981' }
      : { label: 'Leads',          value: fmtNum(d.current.conversions),    delta: deltaHtml(d.current.conversions, d.prior?.conversions),         accent: '#10b981' }
    ),
    !hidden.has('cpl') && (d.isEcomDash
      ? { label: 'ROAS',           value: fmtRoas(d.current.roas),          delta: deltaHtml(d.current.roas, d.prior?.roas),                       accent: '#8b5cf6' }
      : { label: 'Cost Per Lead',  value: d.current.cpl > 0 ? fmtCurrency(d.current.cpl) : '—', delta: deltaHtml(d.current.cpl, d.prior?.cpl, true), accent: '#f59e0b' }
    ),
    !hidden.has('ctr') && { label: 'CTR',           value: fmtPct(d.current.ctr),         delta: deltaHtml(d.current.ctr, d.prior?.ctr),                       accent: '#3b82f6' },
    !hidden.has('conv_rate') && { label: 'Conv. Rate', value: fmtPct(d.convRate),           delta: deltaHtml(d.convRate, d.priorConvRate),                        accent: '#06b6d4' },
    !hidden.has('cpm') && { label: 'CPM',           value: fmtCurrency(d.current.cpm),    delta: deltaHtml(d.current.cpm, d.prior?.cpm, true),                 accent: '#f59e0b' },
    !hidden.has('impressions') && { label: 'Impressions', value: fmtNum(d.current.impressions), delta: deltaHtml(d.current.impressions, d.prior?.impressions), accent: '#6366f1' },
    !hidden.has('cpc') && { label: 'Avg. CPC',      value: d.current.cpc > 0 ? fmtCurrency(d.current.cpc) : '—', delta: deltaHtml(d.current.cpc, d.prior?.cpc, true), accent: '#f97316' },
  ].filter(Boolean) as { label: string; value: string; delta: string; accent: string }[]

  const kpiHtml = kpiCards.map(k => `
    <div style="border:1px solid #e2e6ec;border-top:3px solid ${k.accent};border-radius:8px;padding:16px;background:#fff;min-width:120px;">
      <div style="font-size:0.65rem;font-weight:700;color:#6b7280;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">${k.label}</div>
      <div style="font-size:1.5rem;font-weight:700;color:#111827;line-height:1.2;">${k.value}</div>
      ${k.delta}
    </div>`).join('')

  const campaignRows = d.campaigns.map((c, i) => {
    const bg = i % 2 === 0 ? '#fff' : '#f8f9fb'
    const sourceLabel = c.source === 'google_ads' ? 'Google' : c.source === 'meta_ads' ? 'Meta' : c.source
    const sourceDot = c.source === 'google_ads' ? '#4285f4' : c.source === 'meta_ads' ? '#1877f2' : '#6b7280'
    const statusColor = c.status === 'ENABLED' || c.status === 'ACTIVE' ? '#16a34a' : '#9ca3af'
    return `
    <tr style="background:${bg};">
      <td style="padding:10px 12px;font-size:0.8rem;color:#111827;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${sourceDot};margin-right:6px;vertical-align:middle;"></span>${escHtml(c.name)}
      </td>
      <td style="padding:10px 12px;font-size:0.8rem;color:#6b7280;text-align:right;white-space:nowrap;">${sourceLabel}</td>
      <td style="padding:10px 12px;font-size:0.8rem;color:#111827;font-weight:600;text-align:right;white-space:nowrap;">${fmt$(c.spend)}</td>
      <td style="padding:10px 12px;font-size:0.8rem;color:#111827;text-align:right;">${fmtNum(c.conversions)}</td>
      <td style="padding:10px 12px;font-size:0.8rem;color:#111827;text-align:right;">${c.cpl > 0 ? fmtCurrency(c.cpl) : '—'}</td>
      <td style="padding:10px 12px;font-size:0.8rem;color:#111827;text-align:right;">${fmtPct(c.ctr)}</td>
      <td style="padding:10px 12px;font-size:0.8rem;text-align:center;"><span style="color:${statusColor};font-size:0.85rem;">●</span></td>
    </tr>`
  }).join('')

  const compareLabel = d.showCompare
    ? `<span style="color:#9ca3af;margin-left:12px;font-size:0.8rem;">vs ${fmtDateLabel(d.priorFrom)} – ${fmtDateLabel(d.priorTo)}</span>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Performance Report — ${escHtml(d.clientName)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background: #f8f9fb; color: #111827; }
  .page { max-width: 860px; margin: 0 auto; background: #fff; }
  .print-btn { display: flex; justify-content: center; gap: 12px; padding: 16px; background: #f1f3f6; border-bottom: 1px solid #e2e6ec; }
  table { border-collapse: collapse; width: 100%; }
  @media print {
    body { background: #fff; }
    .no-print { display: none !important; }
    .page { max-width: 100%; box-shadow: none; }
    @page { margin: 12mm 14mm; size: A4; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Print button (screen only) -->
  <div class="print-btn no-print">
    <button onclick="window.print()" style="background:#2563eb;color:#fff;border:none;border-radius:6px;padding:10px 24px;font-size:0.875rem;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:8px;">
      🖨&nbsp; Print / Save as PDF
    </button>
    <button onclick="window.close()" style="background:#fff;color:#374151;border:1px solid #e2e6ec;border-radius:6px;padding:10px 20px;font-size:0.875rem;cursor:pointer;">
      Close
    </button>
  </div>

  <!-- Header -->
  <div style="padding:28px 32px 24px;border-bottom:1px solid #e2e6ec;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;">
    <div style="display:flex;align-items:center;gap:14px;">
      ${d.agencyLogoUrl ? `<img src="${escHtml(d.agencyLogoUrl)}" alt="${escHtml(d.agencyName)}" style="height:36px;max-width:140px;object-fit:contain;" />` : `<div style="font-size:1rem;font-weight:800;color:#2563eb;letter-spacing:-0.02em;">${escHtml(d.agencyName)}</div>`}
    </div>
    <div style="text-align:right;">
      <div style="display:flex;align-items:center;gap:8px;justify-content:flex-end;margin-bottom:4px;">
        ${d.clientLogoUrl ? `<img src="${escHtml(d.clientLogoUrl)}" alt="${escHtml(d.clientName)}" style="height:20px;object-fit:contain;" />` : ''}
        <span style="font-size:1rem;font-weight:700;color:#111827;">${escHtml(d.clientName)}</span>
      </div>
      <div style="font-size:0.8rem;color:#374151;font-weight:500;">Performance Report</div>
      <div style="font-size:0.75rem;color:#6b7280;margin-top:2px;">${fmtDateLabel(d.fromDate)} – ${fmtDateLabel(d.toDate)}${compareLabel}</div>
      ${d.syncedAt ? `<div style="font-size:0.7rem;color:#9ca3af;margin-top:2px;">Updated ${d.syncedAt}</div>` : ''}
    </div>
  </div>

  <!-- KPI section -->
  <div style="padding:28px 32px;border-bottom:1px solid #e2e6ec;">
    <div style="font-size:0.7rem;font-weight:700;color:#9ca3af;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:16px;">Performance Summary</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;">
      ${kpiHtml}
    </div>
  </div>

  <!-- Campaigns section -->
  ${d.campaigns.length > 0 ? `
  <div style="padding:28px 32px 32px;">
    <div style="font-size:0.7rem;font-weight:700;color:#9ca3af;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:16px;">Campaigns <span style="font-weight:400;color:#9ca3af;">(${d.campaigns.length})</span></div>
    <table style="font-size:0.8rem;">
      <thead>
        <tr style="background:#f8f9fb;border-bottom:2px solid #e2e6ec;">
          <th style="padding:10px 12px;text-align:left;font-size:0.7rem;font-weight:700;color:#6b7280;letter-spacing:0.06em;text-transform:uppercase;">Campaign</th>
          <th style="padding:10px 12px;text-align:right;font-size:0.7rem;font-weight:700;color:#6b7280;letter-spacing:0.06em;text-transform:uppercase;">Source</th>
          <th style="padding:10px 12px;text-align:right;font-size:0.7rem;font-weight:700;color:#6b7280;letter-spacing:0.06em;text-transform:uppercase;">Spend</th>
          <th style="padding:10px 12px;text-align:right;font-size:0.7rem;font-weight:700;color:#6b7280;letter-spacing:0.06em;text-transform:uppercase;">Conversions</th>
          <th style="padding:10px 12px;text-align:right;font-size:0.7rem;font-weight:700;color:#6b7280;letter-spacing:0.06em;text-transform:uppercase;">${d.isEcomDash ? 'ROAS' : 'CPA'}</th>
          <th style="padding:10px 12px;text-align:right;font-size:0.7rem;font-weight:700;color:#6b7280;letter-spacing:0.06em;text-transform:uppercase;">CTR</th>
          <th style="padding:10px 12px;text-align:center;font-size:0.7rem;font-weight:700;color:#6b7280;letter-spacing:0.06em;text-transform:uppercase;">Status</th>
        </tr>
      </thead>
      <tbody>${campaignRows}</tbody>
    </table>
  </div>` : ''}

  <!-- GA4 section -->
  ${d.ga4 ? `
  <div style="padding:24px 32px;border-top:1px solid #e2e6ec;">
    <div style="font-size:0.7rem;font-weight:700;color:#9ca3af;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:14px;">Website Traffic (GA4)</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;">
      ${[
        { label: 'Sessions',     value: fmtNum(d.ga4.sessions),    delta: '', accent: '#10b981' },
        { label: 'Users',        value: fmtNum(d.ga4.users),       delta: '', accent: '#3b82f6' },
        { label: 'New Users',    value: fmtNum(d.ga4.newUsers),    delta: '', accent: '#8b5cf6' },
        { label: 'Avg. Session', value: `${Math.floor(d.ga4.avgDuration / 60)}m ${Math.round(d.ga4.avgDuration % 60)}s`, delta: '', accent: '#f59e0b' },
      ].map(k => `<div style="background:#fff;border:1px solid #e2e6ec;border-top:3px solid ${k.accent};border-radius:8px;padding:14px 16px;">
        <div style="font-size:0.65rem;font-weight:700;color:#9ca3af;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">${k.label}</div>
        <div style="font-size:1.25rem;font-weight:700;color:#111827;">${k.value}</div>
      </div>`).join('')}
    </div>
  </div>` : ''}

  <!-- GHL / CRM section -->
  ${d.ghl ? `
  <div style="padding:24px 32px;border-top:1px solid #e2e6ec;">
    <div style="font-size:0.7rem;font-weight:700;color:#9ca3af;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:14px;">CRM Activity (${escHtml(d.crmName)})</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;">
      ${[
        { label: 'New Contacts', value: fmtNum(d.ghl.contacts),   accent: '#10b981' },
        { label: 'Calls',        value: fmtNum(d.ghl.calls),      accent: '#3b82f6' },
        { label: 'Forms',        value: fmtNum(d.ghl.forms),      accent: '#8b5cf6' },
        { label: 'Emails Sent',  value: fmtNum(d.ghl.emailsSent), accent: '#f59e0b' },
        { label: 'SMS Sent',     value: fmtNum(d.ghl.smsSent),    accent: '#f97316' },
      ].map(k => `<div style="background:#fff;border:1px solid #e2e6ec;border-top:3px solid ${k.accent};border-radius:8px;padding:14px 16px;">
        <div style="font-size:0.65rem;font-weight:700;color:#9ca3af;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">${k.label}</div>
        <div style="font-size:1.25rem;font-weight:700;color:#111827;">${k.value}</div>
      </div>`).join('')}
    </div>
  </div>` : ''}

  <!-- Footer -->
  <div style="padding:16px 32px;border-top:1px solid #e2e6ec;display:flex;align-items:center;justify-content:space-between;">
    <span style="font-size:0.7rem;color:#9ca3af;">${escHtml(d.agencyName)}</span>
    <span style="font-size:0.7rem;color:#9ca3af;">Generated ${d.generatedAt}</span>
  </div>

</div>
<script>
  // Auto-trigger print dialog after page loads (only if opened from report button)
  if (window.opener || document.referrer) {
    setTimeout(() => window.print(), 400)
  }
</script>
</body>
</html>`
}

// ─────────────────────────────────────────────────────────────────────────────
// Email HTML (table-based, Outlook/Gmail/iOS compatible)
// ─────────────────────────────────────────────────────────────────────────────

function generateEmailHtml(d: ReportData, hidden: Set<string>): string {
  const BLUE      = '#2563eb'
  const NAVY      = '#0f172a'
  const BG        = '#f1f3f6'
  const WHITE     = '#ffffff'
  const BORDER    = '#e2e6ec'
  const MUTED     = '#6b7280'
  const PRIMARY   = '#111827'
  const FAINT     = '#9ca3af'

  function deltaSpan(val: number, prev: number | null | undefined, invert = false) {
    if (prev == null || !d.showCompare) return ''
    const pct = calcDelta(val, prev)
    if (pct == null) return ''
    const positive = invert ? pct < 0 : pct > 0
    const color = positive ? '#16a34a' : '#dc2626'
    const arrow = pct > 0 ? '&#9650;' : '&#9660;'
    return `&nbsp;<span style="color:${color};font-size:11px;font-weight:600;">${arrow}&nbsp;${Math.abs(pct).toFixed(1)}%</span>`
  }

  // 4 primary KPI cells
  const kpis: { label: string; value: string; delta: string; color: string }[] = []
  if (!hidden.has('spend')) kpis.push({ label: 'Total Cost', value: fmt$(d.current.spend), delta: deltaSpan(d.current.spend, d.prior?.spend, true), color: BLUE })
  if (!hidden.has('leads')) {
    if (d.isEcomDash) kpis.push({ label: 'Revenue', value: fmt$(d.current.conversionValue), delta: deltaSpan(d.current.conversionValue, d.prior?.conversionValue), color: '#10b981' })
    else              kpis.push({ label: 'Leads',   value: fmtNum(d.current.conversions),   delta: deltaSpan(d.current.conversions, d.prior?.conversions),           color: '#10b981' })
  }
  if (!hidden.has('cpl')) {
    if (d.isEcomDash) kpis.push({ label: 'ROAS',          value: fmtRoas(d.current.roas),                                       delta: deltaSpan(d.current.roas, d.prior?.roas),         color: '#8b5cf6' })
    else              kpis.push({ label: 'Cost Per Lead',  value: d.current.cpl > 0 ? fmtCurrency(d.current.cpl) : '—',         delta: deltaSpan(d.current.cpl, d.prior?.cpl, true),     color: '#f59e0b' })
  }
  if (!hidden.has('ctr')) kpis.push({ label: 'CTR', value: fmtPct(d.current.ctr), delta: deltaSpan(d.current.ctr, d.prior?.ctr), color: '#3b82f6' })

  // Render up to 4 KPI cells in a row; fall back gracefully if fewer
  const kpiCount = Math.min(kpis.length, 4)
  const kpiCellWidth = Math.floor(560 / kpiCount)
  const kpiCells = kpis.slice(0, kpiCount).map(k => `
          <td width="${kpiCellWidth}" valign="top" style="padding:0 6px 0 0;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="background:${WHITE};border:1px solid ${BORDER};border-top:3px solid ${k.color};border-radius:6px;padding:14px 12px;">
                <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:700;color:${MUTED};letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">${k.label}</div>
                <div style="font-family:Arial,sans-serif;font-size:22px;font-weight:700;color:${PRIMARY};line-height:1.1;">${k.value}${k.delta}</div>
              </td></tr>
            </table>
          </td>`).join('')

  // Secondary metrics as mini-cards (same style as primary KPIs)
  const secondaryKpis: { label: string; value: string; color: string }[] = []
  if (!hidden.has('conv_rate')) secondaryKpis.push({ label: 'Conv. Rate',  value: fmtPct(d.convRate),                                          color: '#06b6d4' })
  if (!hidden.has('cpm'))       secondaryKpis.push({ label: 'CPM',         value: fmtCurrency(d.current.cpm),                                  color: '#f59e0b' })
  if (!hidden.has('impressions')) secondaryKpis.push({ label: 'Impressions', value: fmtNum(d.current.impressions),                             color: '#6366f1' })
  if (!hidden.has('cpc') && d.current.cpc > 0) secondaryKpis.push({ label: 'Avg. CPC', value: fmtCurrency(d.current.cpc),                    color: '#f97316' })

  const secCellWidth = secondaryKpis.length > 0 ? Math.floor(560 / Math.min(secondaryKpis.length, 4)) : 140
  const secondaryHtml = secondaryKpis.length > 0 ? `
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            ${secondaryKpis.slice(0, 4).map(k => `
            <td width="${secCellWidth}" valign="top" style="padding:0 6px 0 0;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="background:${WHITE};border:1px solid ${BORDER};border-top:3px solid ${k.color};border-radius:6px;padding:10px 12px;">
                  <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:700;color:${MUTED};letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px;">${k.label}</div>
                  <div style="font-family:Arial,sans-serif;font-size:16px;font-weight:700;color:${PRIMARY};line-height:1.1;">${k.value}</div>
                </td></tr>
              </table>
            </td>`).join('')}
          </tr>
        </table>` : ''

  // Campaign rows (top 20)
  const campRows = d.campaigns.slice(0, 20).map((c, i) => {
    const bg = i % 2 === 0 ? WHITE : '#f8f9fb'
    const sourceLabel = c.source === 'google_ads' ? 'Google' : c.source === 'meta_ads' ? 'Meta' : c.source
    return `
              <tr style="background:${bg};">
                <td style="font-family:Arial,sans-serif;padding:9px 10px;font-size:12px;color:${PRIMARY};max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(c.name)}</td>
                <td style="font-family:Arial,sans-serif;padding:9px 10px;font-size:11px;color:${MUTED};text-align:right;white-space:nowrap;">${sourceLabel}</td>
                <td style="font-family:Arial,sans-serif;padding:9px 10px;font-size:12px;color:${PRIMARY};font-weight:600;text-align:right;white-space:nowrap;">${fmt$(c.spend)}</td>
                <td style="font-family:Arial,sans-serif;padding:9px 10px;font-size:12px;color:${PRIMARY};text-align:right;">${fmtNum(c.conversions)}</td>
                <td style="font-family:Arial,sans-serif;padding:9px 10px;font-size:12px;color:${PRIMARY};text-align:right;white-space:nowrap;">${c.cpl > 0 ? fmtCurrency(c.cpl) : '—'}</td>
                <td style="font-family:Arial,sans-serif;padding:9px 10px;font-size:12px;color:${PRIMARY};text-align:right;">${fmtPct(c.ctr)}</td>
              </tr>`
  }).join('')

  const compareSubline = d.showCompare
    ? ` &nbsp;·&nbsp; vs ${fmtDateLabel(d.priorFrom)} &ndash; ${fmtDateLabel(d.priorTo)}`
    : ''

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Performance Report &mdash; ${escHtml(d.clientName)}</title>
  <!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
  <style type="text/css">
    body, table, td { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; }
      .kpi-cell, .sec-cell, .ga4-cell, .ghl-cell {
        display: inline-block !important;
        width: 45% !important;
        margin: 0 2% 10px 0 !important;
        vertical-align: top !important;
      }
      .camp-col-hide { display: none !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${BG};font-family:Arial,Helvetica,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BG};">
  <tr>
    <td align="center" style="padding:24px 16px;">

      <!-- Main container: 600px -->
      <table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

        <!-- ── Header ─────────────────────────────────── -->
        <tr>
          <td style="background-color:${NAVY};padding:24px 28px;border-radius:8px 8px 0 0;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="middle">
                  ${d.agencyLogoUrl
                    ? `<img src="${escHtml(d.agencyLogoUrl)}" alt="${escHtml(d.agencyName)}" height="40" style="display:block;max-height:40px;max-width:180px;object-fit:contain;background:#fff;padding:6px 10px;border-radius:4px;" />`
                    : `<span style="font-family:Arial,sans-serif;font-size:18px;font-weight:700;color:#fff;">${escHtml(d.agencyName)}</span>`}
                </td>
                <td valign="middle" align="right">
                  <div style="font-family:Arial,sans-serif;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;">Performance Report</div>
                  <div style="font-family:Arial,sans-serif;font-size:13px;font-weight:600;color:#fff;margin-top:3px;">${escHtml(d.clientName)}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ── Date bar ───────────────────────────────── -->
        <tr>
          <td style="background-color:${BLUE};padding:10px 28px;">
            <span style="font-family:Arial,sans-serif;font-size:12px;color:rgba(255,255,255,0.9);font-weight:500;">
              ${fmtDateLabel(d.fromDate)} &ndash; ${fmtDateLabel(d.toDate)}${compareSubline}
            </span>
            ${d.syncedAt ? `<span style="font-family:Arial,sans-serif;font-size:11px;color:rgba(255,255,255,0.6);margin-left:16px;">Updated ${d.syncedAt}</span>` : ''}
          </td>
        </tr>

        <!-- ── KPI cards ──────────────────────────────── -->
        <tr>
          <td style="background-color:${WHITE};padding:24px 28px 16px;">
            <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:700;color:${FAINT};letter-spacing:0.1em;text-transform:uppercase;margin-bottom:14px;">Performance Summary</div>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                ${kpiCells}
              </tr>
            </table>
          </td>
        </tr>

        <!-- ── Secondary metrics ──────────────────────── -->
        ${secondaryHtml ? `<tr><td style="background-color:${WHITE};padding:4px 28px 16px;">${secondaryHtml.trim()}</td></tr>` : ''}

        <!-- ── Divider ────────────────────────────────── -->
        <tr>
          <td style="background-color:${WHITE};padding:0 28px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-top:1px solid ${BORDER};padding:0;font-size:0;line-height:0;">&nbsp;</td></tr>
            </table>
          </td>
        </tr>

        <!-- ── Campaign table ─────────────────────────── -->
        ${d.campaigns.length > 0 ? `
        <tr>
          <td style="background-color:${WHITE};padding:20px 28px 28px;">
            <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:700;color:${FAINT};letter-spacing:0.1em;text-transform:uppercase;margin-bottom:12px;">
              Campaign Breakdown <span style="font-weight:400;">(top ${Math.min(d.campaigns.length, 20)})</span>
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BORDER};border-radius:6px;overflow:hidden;">
              <thead>
                <tr style="background-color:#f8f9fb;">
                  <th style="font-family:Arial,sans-serif;padding:9px 10px;font-size:10px;font-weight:700;color:${MUTED};text-align:left;letter-spacing:0.06em;text-transform:uppercase;border-bottom:1px solid ${BORDER};">Campaign</th>
                  <th style="font-family:Arial,sans-serif;padding:9px 10px;font-size:10px;font-weight:700;color:${MUTED};text-align:right;letter-spacing:0.06em;text-transform:uppercase;border-bottom:1px solid ${BORDER};">Source</th>
                  <th style="font-family:Arial,sans-serif;padding:9px 10px;font-size:10px;font-weight:700;color:${MUTED};text-align:right;letter-spacing:0.06em;text-transform:uppercase;border-bottom:1px solid ${BORDER};">Spend</th>
                  <th style="font-family:Arial,sans-serif;padding:9px 10px;font-size:10px;font-weight:700;color:${MUTED};text-align:right;letter-spacing:0.06em;text-transform:uppercase;border-bottom:1px solid ${BORDER};">Conversions</th>
                  <th style="font-family:Arial,sans-serif;padding:9px 10px;font-size:10px;font-weight:700;color:${MUTED};text-align:right;letter-spacing:0.06em;text-transform:uppercase;border-bottom:1px solid ${BORDER};">${d.isEcomDash ? 'ROAS' : 'CPA'}</th>
                  <th style="font-family:Arial,sans-serif;padding:9px 10px;font-size:10px;font-weight:700;color:${MUTED};text-align:right;letter-spacing:0.06em;text-transform:uppercase;border-bottom:1px solid ${BORDER};">CTR</th>
                </tr>
              </thead>
              <tbody>${campRows}</tbody>
            </table>
          </td>
        </tr>` : ''}

        <!-- ── GA4 section ────────────────────────────── -->
        ${d.ga4 ? `
        <tr>
          <td style="background-color:${WHITE};padding:4px 28px 20px;">
            <div style="border-top:1px solid ${BORDER};margin-bottom:16px;"></div>
            <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:700;color:${FAINT};letter-spacing:0.1em;text-transform:uppercase;margin-bottom:12px;">Website Traffic (GA4)</div>
            <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              ${[
                { label: 'Sessions',         value: fmtNum(d.ga4.sessions),    color: '#10b981' },
                { label: 'Users',            value: fmtNum(d.ga4.users),       color: '#3b82f6' },
                { label: 'New Users',        value: fmtNum(d.ga4.newUsers),    color: '#8b5cf6' },
                { label: 'Avg. Session',     value: `${Math.floor(d.ga4.avgDuration / 60)}m ${Math.round(d.ga4.avgDuration % 60)}s`, color: '#f59e0b' },
              ].map(k => `<td width="140" valign="top" style="padding:0 6px 0 0;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                  <td style="background:${WHITE};border:1px solid ${BORDER};border-top:3px solid ${k.color};border-radius:6px;padding:10px 12px;">
                    <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:700;color:${MUTED};letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px;">${k.label}</div>
                    <div style="font-family:Arial,sans-serif;font-size:16px;font-weight:700;color:${PRIMARY};line-height:1.1;">${k.value}</div>
                  </td>
                </tr></table>
              </td>`).join('')}
            </tr></table>
          </td>
        </tr>` : ''}

        <!-- ── GHL / CRM section ─────────────────────── -->
        ${d.ghl ? `
        <tr>
          <td style="background-color:${WHITE};padding:4px 28px 20px;">
            <div style="border-top:1px solid ${BORDER};margin-bottom:16px;"></div>
            <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:700;color:${FAINT};letter-spacing:0.1em;text-transform:uppercase;margin-bottom:12px;">CRM Activity (${escHtml(d.crmName)})</div>
            <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              ${[
                { label: 'New Contacts', value: fmtNum(d.ghl.contacts),   color: '#10b981' },
                { label: 'Calls',        value: fmtNum(d.ghl.calls),      color: '#3b82f6' },
                { label: 'Forms',        value: fmtNum(d.ghl.forms),      color: '#8b5cf6' },
                { label: 'Emails Sent',  value: fmtNum(d.ghl.emailsSent), color: '#f59e0b' },
                { label: 'SMS Sent',     value: fmtNum(d.ghl.smsSent),    color: '#f97316' },
              ].map(k => `<td width="112" valign="top" style="padding:0 6px 0 0;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                  <td style="background:${WHITE};border:1px solid ${BORDER};border-top:3px solid ${k.color};border-radius:6px;padding:10px 12px;">
                    <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:700;color:${MUTED};letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px;">${k.label}</div>
                    <div style="font-family:Arial,sans-serif;font-size:16px;font-weight:700;color:${PRIMARY};line-height:1.1;">${k.value}</div>
                  </td>
                </tr></table>
              </td>`).join('')}
            </tr></table>
          </td>
        </tr>` : ''}

        <!-- ── Footer ─────────────────────────────────── -->
        <tr>
          <td style="background-color:${BG};padding:16px 28px;border-radius:0 0 8px 8px;border:1px solid ${BORDER};border-top:none;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-family:Arial,sans-serif;font-size:11px;color:${FAINT};">${escHtml(d.agencyName)}</td>
                <td style="font-family:Arial,sans-serif;font-size:11px;color:${FAINT};text-align:right;">Generated ${d.generatedAt}</td>
              </tr>
            </table>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

</body>
</html>`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(str: string) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

