// Campaign Detail — /dashboard/campaign/[campaignId]
//
// Ad-level drill-down for a single campaign.
// Shows individual ads with their metrics and thumbnails (Meta only).
// Accessible only by the authenticated client (same cookie as dashboard).

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { getAgencySettings } from '@/lib/agency-settings'
import { applyAdFuel, fmt$, fmtNum, fmtRoas, fmtPct, fmtCurrency } from '@/lib/metrics'
import type { Client } from '@/lib/types'
import AdTable from '@/components/AdTable'

export const dynamic = 'force-dynamic'

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ campaignId: string }>
  searchParams: Promise<{
    source?: string
    connectionId?: string
    from?: string
    to?: string
  }>
}) {
  const cookieStore = await cookies()
  const token = cookieStore.get('client_token')?.value
  if (!token) redirect('/access')

  const db = createAdminClient()

  const clientResult = await db
    .from('clients')
    .select('*')
    .eq('dashboard_token', token)
    .single()
  const client = clientResult.data as Client | null
  if (!client) redirect('/access')

  const { campaignId } = await params
  const sp = await searchParams
  const source       = sp.source       ?? 'google_ads'
  const connectionId = sp.connectionId ?? ''
  const dateFrom     = sp.from ?? (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0] })()
  const dateTo       = sp.to   ?? new Date().toISOString().split('T')[0]

  const [settings] = await Promise.all([getAgencySettings()])
  const adFuelCut = client.ad_fuel_cut != null ? client.ad_fuel_cut : settings.ad_fuel_cut

  // Fetch ad-level metrics for this campaign
  type GoogleAdRow = {
    ad_id: string; ad_name: string; ad_type: string | null
    ad_group_name: string
    spend: number; impressions: number; clicks: number
    conversions: number; conversions_value: number
  }
  type MetaAdRow = {
    ad_id: string; ad_name: string; thumbnail_url: string | null
    adset_name: string | null
    spend: number; impressions: number; clicks: number
    conversions: number; conversion_value: number
  }

  let campaignName = decodeURIComponent(campaignId)

  if (source === 'google_ads') {
    const { data: rows } = await db
      .from('google_ads_ad_metrics')
      .select('ad_id,ad_name,ad_type,ad_group_name,spend,impressions,clicks,conversions,conversions_value')
      .eq('client_id', client.id)
      .eq('campaign_id', campaignId)
      .gte('date', dateFrom)
      .lte('date', dateTo)

    // Aggregate by ad_id
    const adMap = new Map<string, {
      name: string; type: string | null; group: string
      spend: number; impressions: number; clicks: number
      conversions: number; convValue: number
    }>()
    for (const r of (rows ?? []) as GoogleAdRow[]) {
      const ex = adMap.get(r.ad_id)
      if (ex) {
        ex.spend       += r.spend
        ex.impressions += r.impressions
        ex.clicks      += r.clicks
        ex.conversions += r.conversions
        ex.convValue   += r.conversions_value
      } else {
        adMap.set(r.ad_id, {
          name:        r.ad_name,
          type:        r.ad_type,
          group:       r.ad_group_name,
          spend:       r.spend,
          impressions: r.impressions,
          clicks:      r.clicks,
          conversions: r.conversions,
          convValue:   r.conversions_value,
        })
      }
    }

    // Get campaign name from campaign-level table
    const { data: campRow } = await db
      .from('google_ads_metrics')
      .select('campaign_name')
      .eq('client_id', client.id)
      .eq('campaign_id', campaignId)
      .limit(1)
      .single()
    if (campRow) campaignName = (campRow as { campaign_name: string }).campaign_name

    const ads = Array.from(adMap.entries()).map(([id, a]) => ({
      ad_id:         id,
      ad_name:       a.name,
      ad_type:       a.type,
      group_name:    a.group,
      thumbnail_url: null,
      spend:         a.spend,
      impressions:   a.impressions,
      clicks:        a.clicks,
      conversions:   a.conversions,
      conversionValue: a.convValue,
      roas:          a.spend > 0 ? a.convValue / a.spend : 0,
      cpl:           a.conversions > 0 ? a.spend / a.conversions : 0,
      ctr:           a.impressions > 0 ? a.clicks / a.impressions : 0,
      adFuelSpend:   applyAdFuel(a.spend, adFuelCut),
    })).sort((a, b) => b.spend - a.spend)

    const totSpend = ads.reduce((s, a) => s + a.spend, 0)
    const totImpressions = ads.reduce((s, a) => s + a.impressions, 0)
    const totClicks = ads.reduce((s, a) => s + a.clicks, 0)
    const totConversions = ads.reduce((s, a) => s + a.conversions, 0)

    return (
      <DashboardShell client={client} settings={settings}>
        <CampaignHeader
          campaignName={campaignName}
          source={source}
          dateFrom={dateFrom}
          dateTo={dateTo}
          backHref={buildBackHref(source, dateFrom, dateTo)}
        />
        <SummaryRow
          spend={totSpend}
          adFuelSpend={applyAdFuel(totSpend, adFuelCut)}
          adFuelCut={adFuelCut}
          impressions={totImpressions}
          clicks={totClicks}
          conversions={totConversions}
        />
        <div className="card" style={{ padding: '1.5rem' }}>
          <h2 className="section-title mb-4">Ads ({ads.length})</h2>
          <AdTable ads={ads} adFuelCut={adFuelCut} />
        </div>
      </DashboardShell>
    )
  }

  // ── Meta ──────────────────────────────────────────────────────────────────
  const { data: rows } = await db
    .from('meta_ads_ad_metrics')
    .select('ad_id,ad_name,thumbnail_url,adset_name,spend,impressions,clicks,conversions,conversion_value')
    .eq('client_id', client.id)
    .eq('campaign_id', campaignId)
    .gte('date', dateFrom)
    .lte('date', dateTo)

  const adMap = new Map<string, {
    name: string; thumb: string | null; adset: string | null
    spend: number; impressions: number; clicks: number
    conversions: number; convValue: number
  }>()
  for (const r of (rows ?? []) as MetaAdRow[]) {
    const ex = adMap.get(r.ad_id)
    if (ex) {
      ex.spend       += r.spend
      ex.impressions += r.impressions
      ex.clicks      += r.clicks
      ex.conversions += r.conversions
      ex.convValue   += r.conversion_value
    } else {
      adMap.set(r.ad_id, {
        name:        r.ad_name,
        thumb:       r.thumbnail_url,
        adset:       r.adset_name,
        spend:       r.spend,
        impressions: r.impressions,
        clicks:      r.clicks,
        conversions: r.conversions,
        convValue:   r.conversion_value,
      })
    }
  }

  const { data: campRow } = await db
    .from('meta_ads_metrics')
    .select('campaign_name')
    .eq('client_id', client.id)
    .eq('campaign_id', campaignId)
    .limit(1)
    .single()
  if (campRow) campaignName = (campRow as { campaign_name: string }).campaign_name

  const ads = Array.from(adMap.entries()).map(([id, a]) => ({
    ad_id:           id,
    ad_name:         a.name,
    ad_type:         null,
    group_name:      a.adset ?? null,
    thumbnail_url:   a.thumb,
    spend:           a.spend,
    impressions:     a.impressions,
    clicks:          a.clicks,
    conversions:     a.conversions,
    conversionValue: a.convValue,
    roas:            a.spend > 0 ? a.convValue / a.spend : 0,
    cpl:             a.conversions > 0 ? a.spend / a.conversions : 0,
    ctr:             a.impressions > 0 ? a.clicks / a.impressions : 0,
    adFuelSpend:     applyAdFuel(a.spend, adFuelCut),
  })).sort((a, b) => b.spend - a.spend)

  const totSpend = ads.reduce((s, a) => s + a.spend, 0)
  const totImpressions = ads.reduce((s, a) => s + a.impressions, 0)
  const totClicks = ads.reduce((s, a) => s + a.clicks, 0)
  const totConversions = ads.reduce((s, a) => s + a.conversions, 0)

  return (
    <DashboardShell client={client} settings={settings}>
      <CampaignHeader
        campaignName={campaignName}
        source={source}
        dateFrom={dateFrom}
        dateTo={dateTo}
        backHref={buildBackHref(source, dateFrom, dateTo)}
      />
      <SummaryRow
        spend={totSpend}
        adFuelSpend={applyAdFuel(totSpend, adFuelCut)}
        adFuelCut={adFuelCut}
        impressions={totImpressions}
        clicks={totClicks}
        conversions={totConversions}
      />
      <div className="card" style={{ padding: '1.5rem' }}>
        <h2 className="section-title mb-4">Ads ({ads.length})</h2>
        <AdTable ads={ads} adFuelCut={adFuelCut} />
      </div>
    </DashboardShell>
  )
}

function buildBackHref(source: string, dateFrom: string, dateTo: string) {
  const qs = new URLSearchParams({ source, from: dateFrom, to: dateTo })
  return `/dashboard?${qs}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout sub-components
// ─────────────────────────────────────────────────────────────────────────────

function DashboardShell({
  client,
  settings,
  children,
}: {
  client: Client
  settings: { agency_name: string; agency_logo_url?: string }
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <header
        className="sticky top-0 z-10 border-b"
        style={{
          background:  'var(--bg-surface)',
          borderColor: 'var(--border)',
          boxShadow:   '0 1px 3px rgba(0,0,0,0.06)',
        }}
      >
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-3">
          {settings.agency_logo_url && (
            <img
              src={settings.agency_logo_url}
              alt={settings.agency_name}
              className="max-h-7 max-w-[140px] object-contain"
            />
          )}
          <span className="hidden sm:block text-sm" style={{ color: 'var(--text-muted)' }}>
            {settings.agency_name}
          </span>
          <span style={{ color: 'var(--border)' }}>|</span>
          <div className="flex items-center gap-2">
            {client.logo_url && (
              <img src={client.logo_url} alt={client.name} className="h-5 object-contain" />
            )}
            <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
              {client.name}
            </span>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">
        {children}
      </main>
    </div>
  )
}

function CampaignHeader({
  campaignName,
  source,
  dateFrom,
  dateTo,
  backHref,
}: {
  campaignName: string
  source: string
  dateFrom: string
  dateTo: string
  backHref: string
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-sm">
        <Link href={backHref} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
          ← Back to Campaigns
        </Link>
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
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {dateFrom} – {dateTo}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function SummaryRow({
  spend,
  adFuelSpend,
  adFuelCut,
  impressions,
  clicks,
  conversions,
}: {
  spend: number
  adFuelSpend: number
  adFuelCut: number
  impressions: number
  clicks: number
  conversions: number
}) {
  const ctr = impressions > 0 ? clicks / impressions : 0
  const cpl = conversions > 0 ? spend / conversions : 0

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
      <StatCard label={adFuelCut > 0 ? 'Ad Fuel Cost' : 'Total Spend'}>
        <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
          {fmt$(adFuelCut > 0 ? adFuelSpend : spend)}
        </span>
        {adFuelCut > 0 && (
          <span className="text-xs ml-1" style={{ color: 'var(--text-faint)' }}>
            ({fmt$(spend)} raw)
          </span>
        )}
      </StatCard>
      <StatCard label="Impressions">
        <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
          {fmtNum(impressions)}
        </span>
      </StatCard>
      <StatCard label="Clicks">
        <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
          {fmtNum(clicks)}
        </span>
        <span className="text-xs ml-1" style={{ color: 'var(--text-faint)' }}>
          {fmtPct(ctr)} CTR
        </span>
      </StatCard>
      <StatCard label="Conversions">
        <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
          {conversions.toFixed(1)}
        </span>
      </StatCard>
      <StatCard label="CPL">
        <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
          {cpl > 0 ? fmtCurrency(cpl) : '—'}
        </span>
      </StatCard>
    </div>
  )
}

function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <div className="flex items-baseline gap-1">{children}</div>
    </div>
  )
}
