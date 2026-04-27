// Client Detail — /admin/clients/[id]
// Tabbed management page: General / Data Sources / Performance / Content / Advanced

import { unstable_noStore as noStore } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Client, ClientConnection, Connector, SyncJob } from '@/lib/types'
import {
  GOOGLE_CONNECTOR_TYPES,
  UNGROUPED_CONNECTOR_TYPES,
  getConnectorDef,
  isConnectorImplemented,
} from '@/lib/connectors/registry'
import { DEFAULT_SETTINGS } from '@/lib/agency-settings'
import CopyButton from '@/components/CopyButton'
import { ConnectorLogo } from '@/components/ConnectorLogo'
import ClientSyncButton from './ClientSyncButton'
import ClientManualSync from './ClientManualSync'
import EditClientInfo from './EditClientInfo'
import DeleteClientButton from './DeleteClientButton'
import DataPurgeButton from './DataPurgeButton'
import ClientLogoUpload from './ClientLogoUpload'
import ClientAdFuelCut from './ClientAdFuelCut'
import ClientRawData from './ClientRawData'
import ClientConversionMapping from './ClientConversionMapping'
import ClientCampaignManager from './ClientCampaignManager'
import ClientBenchmarks from './ClientBenchmarks'
import ClientMetricVisibility from './ClientMetricVisibility'
import type { MetricLayouts } from '@/lib/metric-layouts'
import ClientDirectConnections from './ClientDirectConnections'
import ClientContentSettingsForm from '@/components/admin/ClientContentSettingsForm'
import GscInsightsPanel from '@/components/admin/GscInsightsPanel'
import type { GscInsightRow } from '@/components/admin/GscInsightsPanel'

export const dynamic = 'force-dynamic'

const TABS = [
  { id: 'general',      label: 'General'      },
  { id: 'sources',      label: 'Data Sources' },
  { id: 'performance',  label: 'Metrics'      },
  { id: 'content',      label: 'Content'      },
  { id: 'advanced',     label: 'Advanced'     },
]

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ connected?: string; synced?: string; error?: string; tab?: string }>
}) {
  noStore()
  const { id } = await params
  const sp = await searchParams
  const activeTab = TABS.find(t => t.id === sp.tab)?.id ?? 'general'
  const db = createAdminClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

  const [clientRes, connectionsRes, connectorsRes, recentJobsRes, settingsRes, discoveredRes] = await Promise.all([
    db.from('clients').select('*').eq('id', id).single(),
    db.from('client_connections')
      .select('*, connector:connectors(*)')
      .eq('client_id', id)
      .order('created_at'),
    db.from('connectors').select('*').order('created_at'),
    db.from('sync_jobs')
      .select('*')
      .eq('client_id', id)
      .order('started_at', { ascending: false })
      .limit(10),
    db.from('agency_settings').select('ad_fuel_cut,default_lead_action,default_purchase_action,benchmark_roas,benchmark_ctr,benchmark_cpc,benchmark_conv_rate,benchmark_cpm,benchmark_cpl,metric_layouts').single(),
    db.from('meta_ads_metrics')
      .select('discovered_actions')
      .eq('client_id', id)
      .not('discovered_actions', 'is', null)
      .limit(200),
  ])

  const client = clientRes.data as Client | null
  if (!client) notFound()

  const connections  = (connectionsRes.data ?? []) as (ClientConnection & { connector: Connector })[]
  const connectors   = (connectorsRes.data  ?? []) as Connector[]
  const recentJobs   = (recentJobsRes.data  ?? []) as SyncJob[]
  const agencySettings = settingsRes.data as {
    ad_fuel_cut?: number
    default_lead_action?: string
    default_purchase_action?: string
    benchmark_roas?: number
    benchmark_ctr?: number
    benchmark_cpc?: number
    benchmark_conv_rate?: number
    benchmark_cpm?: number
    benchmark_cpl?: number
    metric_layouts?: MetricLayouts | null
  } | null
  const globalCut    = agencySettings?.ad_fuel_cut ?? DEFAULT_SETTINGS.ad_fuel_cut
  const agencyLead   = agencySettings?.default_lead_action     ?? 'lead'
  const agencyPurch  = agencySettings?.default_purchase_action ?? 'purchase'
  const globalBenchmarks = {
    benchmark_roas:      agencySettings?.benchmark_roas      ?? DEFAULT_SETTINGS.benchmark_roas,
    benchmark_ctr:       agencySettings?.benchmark_ctr       ?? DEFAULT_SETTINGS.benchmark_ctr,
    benchmark_cpc:       agencySettings?.benchmark_cpc       ?? DEFAULT_SETTINGS.benchmark_cpc,
    benchmark_conv_rate: agencySettings?.benchmark_conv_rate ?? DEFAULT_SETTINGS.benchmark_conv_rate,
    benchmark_cpm:       agencySettings?.benchmark_cpm       ?? DEFAULT_SETTINGS.benchmark_cpm,
    benchmark_cpl:       agencySettings?.benchmark_cpl       ?? DEFAULT_SETTINGS.benchmark_cpl ?? 50,
  }

  const discoveredActions = Array.from(new Set(
    (discoveredRes.data ?? []).flatMap(r => (r.discovered_actions as string[] | null) ?? [])
  )).sort()

  const clientWithActions = client as Client & { lead_action?: string | null; purchase_action?: string | null }
  const connByType = new Map(connections.map(c => [c.connector.type, c]))
  const dashUrl    = `${appUrl}/api/auth/access?token=${client.dashboard_token}`

  function tabUrl(tab: string) {
    return `/admin/clients/${id}?tab=${tab}`
  }

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-4 text-sm">
        <Link href="/admin/dashboard" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
          Clients
        </Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{client.name}</span>
      </div>

      {/* Flash notices */}
      {sp.connected && <Notice type="success">{sp.connected.replace(/_/g, ' ')} connected successfully.</Notice>}
      {sp.synced    && <Notice type="success">Sync complete.</Notice>}
      {sp.error     && <Notice type="error">Error: {sp.error.replace(/_/g, ' ')}</Notice>}

      {/* Page heading */}
      <div className="page-header" style={{ marginBottom: '0.5rem' }}>
        <div>
          <h1 className="page-title">{client.name}</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>/admin/clients/{id}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/api/admin/preview/${id}`} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.375rem 0.75rem' }}>
            Preview Dashboard →
          </Link>
        </div>
      </div>

      {/* Tab nav */}
      <style>{`.tab-nav-bar::-webkit-scrollbar { display: none; }`}</style>
      <div className="tab-nav-bar" style={{
        display: 'flex', gap: 2, marginBottom: '1.5rem',
        borderBottom: '1px solid var(--border-subtle)',
        overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none',
      }}>
        {TABS.map(tab => (
          <Link
            key={tab.id}
            href={tabUrl(tab.id)}
            style={{
              display: 'inline-block',
              padding: '0.5rem 1rem', textDecoration: 'none',
              fontSize: '0.8125rem', fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent, var(--blue))' : '2px solid transparent',
              whiteSpace: 'nowrap', marginBottom: -1,
            }}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* ── GENERAL ──────────────────────────────────────────────── */}
      {activeTab === 'general' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl">
          <div className="space-y-4">
            <div className="card p-5">
              <h2 className="section-title mb-3">Client Info</h2>
              <EditClientInfo clientId={id} name={client.name} slug={client.slug ?? ''} discordChannelId={client.discord_channel_id} />
            </div>

            <div className="card p-5">
              <h2 className="section-title mb-3">Client Logo</h2>
              <p className="section-desc mb-3">Displayed on the client&apos;s reporting dashboard.</p>
              <ClientLogoUpload clientId={id} currentLogoUrl={client.logo_url} />
            </div>

            <div className="card p-5">
              <h2 className="section-title mb-1">Ad Fuel Cut</h2>
              <p className="section-desc mb-3">Per-client margin override. Ad Fuel Spend = raw spend ÷ (1 − cut).</p>
              <ClientAdFuelCut clientId={id} currentCut={client.ad_fuel_cut} globalCut={globalCut} />
            </div>
          </div>

          <div className="space-y-4">
            <div className="card p-5">
              <h2 className="section-title mb-1">Dashboard Link</h2>
              <p className="section-desc mb-3">Share with the client to access their reporting dashboard.</p>
              <div
                className="flex items-center gap-2 rounded-lg px-3 py-2.5"
                style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}
              >
                <span className="text-xs font-mono truncate flex-1" style={{ color: 'var(--text-muted)' }}>
                  {dashUrl}
                </span>
                <CopyButton text={dashUrl} />
              </div>
            </div>

            <div className="card p-5">
              <h2 className="section-title mb-1">Manual Sync</h2>
              <p className="section-desc mb-3">Pull the last 30 days for all connected accounts.</p>
              <ClientManualSync clientId={id} />
            </div>
          </div>
        </div>
      )}

      {/* ── DATA SOURCES ─────────────────────────────────────────── */}
      {activeTab === 'sources' && (
        <div className="space-y-4 max-w-2xl">

          {/* ── Google group card ──────────────────────────────────── */}
          <div className="card p-5">
            {/* Header */}
            <div className="flex items-center gap-3 pb-3 mb-1" style={{ borderBottom: '1px solid var(--border)' }}>
              <div
                className="h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 text-white font-bold"
                style={{ background: '#4285F4', fontSize: '1rem' }}
              >
                G
              </div>
              <div>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Google</h3>
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Ads · Analytics · Search Console · Business Profile</p>
              </div>
            </div>

            {/* Sub-rows — one per Google connector type */}
            <div className="space-y-2 mt-3">
              {GOOGLE_CONNECTOR_TYPES.map(type => {
                const def        = getConnectorDef(type)
                const connection = connByType.get(type)
                const connector  = connectors.find(c => c.type === type)

                const state =
                  !connector ? 'connector-missing'
                  : connection ? 'connected'
                  : 'not-connected'

                return (
                  <div
                    key={type}
                    className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5"
                    style={{ background: 'var(--bg-subtle)' }}
                  >
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <div
                        className="h-6 w-6 rounded flex items-center justify-center flex-shrink-0"
                        style={{ background: `${def.color}18`, border: `1px solid ${def.color}30` }}
                      >
                        {def.logo
                          ? <def.logo size={14} />
                          : <span style={{ color: def.color, fontWeight: 700, fontSize: '0.65rem' }}>{def.icon}</span>
                        }
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                            {def.label}
                          </span>
                          <SourceBadge state={state} compact />
                        </div>
                        {state === 'connected' && connection && (
                          <p className="text-xs truncate" style={{ color: 'var(--text-faint)' }}>
                            {connection.external_name ?? connection.external_id}
                            {connection.last_synced_at && ` · synced ${new Date(connection.last_synced_at).toLocaleString('en-US', { month: 'short', day: 'numeric' })}`}
                          </p>
                        )}
                        {state === 'connector-missing' && (
                          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                            <Link href="/admin/connections" style={{ color: 'var(--blue)' }}>Set up agency Google connection first →</Link>
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {state === 'connected' && connection && (
                        <>
                          <ClientSyncButton clientId={id} connectionId={connection.id} />
                          <Link
                            href={`/admin/clients/${id}/connections/${connection.id}`}
                            className="btn btn-secondary"
                            style={{ padding: '0.25rem 0.625rem', fontSize: '0.75rem' }}
                          >
                            Settings
                          </Link>
                        </>
                      )}
                      {state === 'not-connected' && connector && (
                        <Link
                          href={`/admin/clients/${id}/connections/new?connector=${connector.id}`}
                          className="btn btn-primary"
                          style={{ padding: '0.25rem 0.625rem', fontSize: '0.75rem' }}
                        >
                          Assign Account
                        </Link>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Ungrouped flat cards ───────────────────────────────── */}
          {UNGROUPED_CONNECTOR_TYPES.map(type => {
            const def         = getConnectorDef(type)
            const connection  = connByType.get(type)
            const connector   = connectors.find(c => c.type === type)
            const implemented = isConnectorImplemented(type)
            const isDirectType = type === 'ghl' || type === 'wordpress'

            const state =
              !implemented ? 'coming-soon'
              : isDirectType
                ? (connection ? 'connected' : 'direct-connect')
                : !connector ? 'connector-missing'
                : connection ? 'connected'
                : 'not-connected'

            const existingDirectTypes = connections
              .filter(c => c.connector.type === 'ghl' || c.connector.type === 'wordpress')
              .map(c => c.connector.type as 'ghl' | 'wordpress')

            return (
              <div key={type} className="card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div
                      className="h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: state === 'coming-soon' ? '#f3f4f6' : `${def.color}15`, border: `1px solid ${def.color}30` }}
                    >
                      {def.logo
                        ? <def.logo size={22} />
                        : <span style={{ color: def.color, fontWeight: 700, fontSize: '0.9rem' }}>{def.icon}</span>
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{def.label}</h3>
                        <SourceBadge state={state} />
                      </div>
                      {state === 'connected' && connection && (
                        <div className="text-xs space-y-0.5" style={{ color: 'var(--text-muted)' }}>
                          <p>{connection.external_name ?? connection.external_id}</p>
                          {connection.last_synced_at && (
                            <p>Last synced {new Date(connection.last_synced_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
                          )}
                        </div>
                      )}
                      {state === 'connector-missing' && (
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          <Link href="/admin/connections" style={{ color: 'var(--blue)' }}>Set up agency {def.label} connection first →</Link>
                        </p>
                      )}
                      {state === 'not-connected' && (
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Agency connector is ready — assign an account to this client.</p>
                      )}
                      {state === 'coming-soon' && (
                        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{def.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {state === 'connected' && connection && (
                      <>
                        <ClientSyncButton clientId={id} connectionId={connection.id} />
                        <Link href={`/admin/clients/${id}/connections/${connection.id}`} className="btn btn-secondary" style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}>
                          Settings
                        </Link>
                      </>
                    )}
                    {state === 'not-connected' && connector && (
                      <Link href={`/admin/clients/${id}/connections/new?connector=${connector.id}`} className="btn btn-primary" style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}>
                        Connect Account
                      </Link>
                    )}
                  </div>
                </div>
                {state === 'direct-connect' && isDirectType && (
                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                    <ClientDirectConnections clientId={id} existingTypes={existingDirectTypes} singleType={type as 'ghl' | 'wordpress'} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── PERFORMANCE ──────────────────────────────────────────── */}
      {activeTab === 'performance' && (
        <div className="space-y-6 max-w-3xl">
          <div className="card p-5">
            <h2 className="section-title mb-1">Performance Benchmarks</h2>
            <p className="section-desc mb-4">Toggle visibility on the client dashboard and optionally override global benchmark targets for this client.</p>
            <ClientBenchmarks
              clientId={id}
              showBenchmarks={!!client.show_benchmarks}
              globalDefaults={globalBenchmarks}
              current={{
                benchmark_roas:      client.benchmark_roas,
                benchmark_ctr:       client.benchmark_ctr,
                benchmark_cpc:       client.benchmark_cpc,
                benchmark_conv_rate: client.benchmark_conv_rate,
                benchmark_cpm:       client.benchmark_cpm,
                benchmark_cpl:       client.benchmark_cpl,
                enabled_benchmarks:  client.enabled_benchmarks,
              }}
            />
          </div>

          <div className="card p-5">
            <h2 className="section-title mb-1">Dashboard Layout</h2>
            <p className="section-desc mb-4">Configure layout type, custom metric arrangement, and section visibility for this client.</p>
            <ClientMetricVisibility
              clientId={id}
              initialHidden={Array.isArray(client.hidden_metrics) ? client.hidden_metrics : []}
              initialLayoutType={client.layout_type ?? null}
              initialLayoutOverride={(client.metric_layout_override as MetricLayouts | null) ?? null}
              agencyLayouts={(agencySettings?.metric_layouts as MetricLayouts | null) ?? null}
            />
          </div>

          <div className="card p-5">
            <h2 className="section-title mb-1">Campaign Settings</h2>
            <p className="section-desc mb-4">Configure the display mode (Lead Gen / Ecom) and visibility for each discovered campaign.</p>
            <ClientCampaignManager clientId={id} />
          </div>

          <div className="card p-5">
            <h2 className="section-title mb-1">Conversion Mapping</h2>
            <p className="section-desc mb-4">Map Meta action types to conversions for Lead Gen and Ecommerce campaigns.</p>
            <ClientConversionMapping
              clientId={id}
              leadAction={clientWithActions.lead_action ?? null}
              purchaseAction={clientWithActions.purchase_action ?? null}
              agencyLeadAction={agencyLead}
              agencyPurchaseAction={agencyPurch}
              discoveredActions={discoveredActions}
            />
          </div>
        </div>
      )}

      {/* ── CONTENT ──────────────────────────────────────────────── */}
      {activeTab === 'content' && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 400px',
          gap: '2rem',
          alignItems: 'start',
        }}>
          <div>
            <ClientContentSettingsSection clientId={id} />
          </div>
          <div>
            <GscOpportunitiesPanel clientId={id} isEcom={client.layout_type === 'ecom'} />
          </div>
        </div>
      )}

      {/* ── ADVANCED ─────────────────────────────────────────────── */}
      {activeTab === 'advanced' && (
        <div className="space-y-6 max-w-3xl">
          {recentJobs.length > 0 && (
            <div className="card p-5">
              <h2 className="section-title mb-3">Recent Syncs</h2>
              <div className="space-y-2">
                {recentJobs.slice(0, 10).map(job => (
                  <div key={job.id} className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {new Date(job.started_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                    <span className={`badge ${job.status === 'success' ? 'badge-green' : job.status === 'error' ? 'badge-red' : 'badge-amber'}`}>
                      {job.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card p-5">
            <h2 className="section-title mb-1">Raw Data Inspector</h2>
            <p className="section-desc mb-4">Browse the raw synced campaign-level data for this client. Useful for diagnosing sync issues.</p>
            <ClientRawData clientId={id} />
          </div>

          <DataPurgeButton clientId={id} />

          <div className="card p-5">
            <h2 className="section-title mb-3">Delete Client</h2>
            <p className="section-desc mb-3">Deleting this client will remove all their data sources and sync history. Metrics data is also removed.</p>
            <DeleteClientButton clientId={id} clientName={client.name} />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Client Content Settings Section (form only) ─────────────────────────────

async function ClientContentSettingsSection({ clientId }: { clientId: string }) {
  const db = createAdminClient()

  const { data: wpConnData } = await db
    .from('client_connections')
    .select('id, external_id, external_name, connector:connectors!inner(type, config)')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .eq('connector.type', 'wordpress')

  type WpConn = {
    id: string
    external_id: string
    external_name: string | null
    connector: { type: string; config: Record<string, unknown> }
  }

  const sites = ((wpConnData ?? []) as unknown as WpConn[]).map(c => ({
    connectionId: c.id,
    siteUrl:      c.external_id || String((c.connector.config as Record<string, string>).site_url ?? ''),
    siteName:     c.external_name || (() => { try { return new URL(c.external_id || '').hostname } catch { return c.external_id || 'unknown' } })(),
    clientId,
  }))

  return (
    <div>
      <div className="mb-6">
        <h2 className="page-title" style={{ fontSize: '1.125rem' }}>Content Settings</h2>
        <p className="section-desc">Configure AI content generation for this client — business background, brand voice, publishing schedule, and more.</p>
      </div>
      <ClientContentSettingsForm clientId={clientId} sites={sites} />
    </div>
  )
}

// ─── GSC Opportunities Panel (right column of content tab) ───────────────────

async function GscOpportunitiesPanel({ clientId, isEcom }: { clientId: string; isEcom: boolean }) {
  const db = createAdminClient()

  // 28-day window so per-day rows aggregate to meaningful totals per (query, page)
  const windowStart = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10)

  const [{ data: rawRows }, { data: recentPosts }] = await Promise.all([
    db.from('gsc_metrics')
      .select('page, query, impressions, clicks, ctr, position')
      .eq('client_id', clientId)
      .gte('date', windowStart)
      .neq('page', '')
      .neq('query', '')
      .not('page', 'ilike', '%?%'),
    db.from('content_posts')
      .select('target_keyword')
      .eq('client_id', clientId)
      .gte('generated_at', new Date(Date.now() - 90 * 86_400_000).toISOString())
      .limit(60),
  ])

  // Aggregate by (query, page) — weighted average for position and CTR
  type AggRow = { page: string; query: string; impressions: number; clicks: number; weightedPos: number; weightedCtr: number }
  const agg = new Map<string, AggRow>()

  for (const r of (rawRows ?? []) as { page: string; query: string; impressions: number; clicks: number; ctr: number; position: number }[]) {
    if (!r.page || !r.query) continue
    if (isEcom && (
      r.page.includes('/product/') || r.page.includes('/products/') ||
      r.page.includes('/shop/')    || r.page.includes('/collection/') ||
      r.page.includes('/collections/')
    )) continue

    const key  = `${r.query}||${r.page}`
    const impr = r.impressions ?? 0
    const ex   = agg.get(key)
    if (ex) {
      const total = ex.impressions + impr
      ex.weightedPos = total > 0 ? (ex.weightedPos * ex.impressions + (r.position ?? 0) * impr) / total : ex.weightedPos
      ex.weightedCtr = total > 0 ? (ex.weightedCtr * ex.impressions + (r.ctr      ?? 0) * impr) / total : ex.weightedCtr
      ex.impressions += impr
      ex.clicks      += r.clicks ?? 0
    } else {
      agg.set(key, { page: r.page, query: r.query, impressions: impr, clicks: r.clicks ?? 0,
        weightedPos: r.position ?? 0, weightedCtr: r.ctr ?? 0 })
    }
  }

  // Mark keywords used in the last 90 days of generated posts
  const recentKeywords = new Set(
    (recentPosts ?? []).map(p => ((p as { target_keyword?: string }).target_keyword ?? '').toLowerCase().trim()).filter(Boolean)
  )

  const aggRows = Array.from(agg.values()).map(r => ({
    page:             r.page,
    query:            r.query,
    impressions:      r.impressions,
    ctr:              r.weightedCtr,
    position:         r.weightedPos,
    recentlyTargeted: recentKeywords.has(r.query.toLowerCase().trim()),
  }))

  // Filter into sections — thresholds are 28-day totals (not single-day)
  const sortSection = (rows: typeof aggRows, limit: number) =>
    rows
      .sort((a, b) => {
        if (a.recentlyTargeted !== b.recentlyTargeted) return a.recentlyTargeted ? 1 : -1
        return b.impressions - a.impressions
      })
      .slice(0, limit)

  const quickWins = sortSection(
    aggRows.filter(r => r.position >= 5 && r.position <= 10 && r.impressions > 15 && r.ctr < 0.15),
    12
  )
  const growth = sortSection(
    aggRows.filter(r => r.position > 10 && r.position <= 20 && r.impressions > 10),
    12
  )
  const lowCtr = sortSection(
    aggRows.filter(r => r.position >= 1 && r.position <= 5  && r.impressions > 20 && r.ctr < 0.06),
    10
  )

  return <GscInsightsPanel quickWins={quickWins} growth={growth} lowCtr={lowCtr} />
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SourceBadge({ state, compact = false }: { state: string; compact?: boolean }) {
  const m: Record<string, { label: string; cls: string }> = {
    connected:           { label: 'Connected',   cls: 'badge-green' },
    'connector-missing': { label: 'Not set up',  cls: 'badge-amber' },
    'not-connected':     { label: 'Available',   cls: 'badge-gray'  },
    'coming-soon':       { label: 'Coming soon', cls: 'badge-gray'  },
    'direct-connect':    { label: 'Not set up',  cls: 'badge-amber' },
  }
  const d = m[state] ?? { label: state, cls: 'badge-gray' }
  return (
    <span
      className={`badge ${d.cls}`}
      style={compact ? { fontSize: '0.6rem', padding: '1px 5px' } : undefined}
    >
      {d.label}
    </span>
  )
}

function Notice({ type, children }: { type: 'success' | 'error'; children: React.ReactNode }) {
  const s = type === 'success'
    ? { bg: 'var(--green-subtle)', border: '#bbf7d0', color: 'var(--green)' }
    : { bg: 'var(--red-subtle)',   border: '#fecaca', color: 'var(--red)'   }
  return (
    <div className="mb-4 rounded-xl px-4 py-3 text-sm" style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.color }}>
      {children}
    </div>
  )
}
