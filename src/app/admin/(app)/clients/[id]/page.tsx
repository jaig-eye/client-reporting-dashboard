// Client Detail — /admin/clients/[id]
// Tabbed management page: Overview / Integrations / Metrics / Content / Billing / Advanced

import { unstable_noStore as noStore } from 'next/cache'
import { Suspense } from 'react'
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
import { ConnectorLogo } from '@/components/ConnectorLogo'
import ClientSyncButton from './ClientSyncButton'
import ClientManualSync from './ClientManualSync'
import DataPurgeButton from './DataPurgeButton'
import ClientLogoUpload from './ClientLogoUpload'
import ClientRawData from './ClientRawData'
import ClientConversionMapping from './ClientConversionMapping'
import ClientCampaignManager from './ClientCampaignManager'
import ClientBenchmarks from './ClientBenchmarks'
import ClientMetricVisibility from './ClientMetricVisibility'
import type { MetricLayouts } from '@/lib/metric-layouts'
import ClientDirectConnections from './ClientDirectConnections'
import ClientAutoPauseSettings from './ClientAutoPauseSettings'
import ClientBcDailyReport from './ClientBcDailyReport'
import ClientIntegrationCards from '@/components/admin/ClientIntegrationCards'
import ClientContentTabPanel from '@/components/admin/ClientContentTabPanel'
import type { GscData } from '@/components/admin/ClientContentTabPanel'
import OverviewTab from './OverviewTab'
import BillingTab from './BillingTab'
import { CopyAdLibraryButton } from '@/components/admin/CopyAdLibraryButton'

export const dynamic = 'force-dynamic'

const TABS = [
  { id: 'overview',    label: 'Overview'     },
  { id: 'sources',     label: 'Integrations' },
  { id: 'performance', label: 'Metrics'      },
  { id: 'content',     label: 'Content'      },
  { id: 'billing',     label: 'Billing'      },
  { id: 'advanced',    label: 'Advanced'     },
]

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ connected?: string; synced?: string; error?: string; tab?: string; subtab?: string }>
}) {
  noStore()
  const { id } = await params
  const sp = await searchParams
  const activeTab     = TABS.find(t => t.id === sp.tab)?.id ?? 'overview'
  const initialSubTab = sp.subtab ?? 'overview'
  const db = createAdminClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

  // Always-needed data
  const [clientRes, connectionsRes, connectorsRes, recentJobsRes, settingsRes, discoveredRes, coverageRes, pauseLogRes] = await Promise.all([
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
      .limit(20),
    db.from('agency_settings').select('ad_fuel_cut,default_lead_action,default_purchase_action,benchmark_roas,benchmark_ctr,benchmark_cpc,benchmark_conv_rate,benchmark_cpm,benchmark_cpl,metric_layouts,ai_api_key').single(),
    db.from('meta_ads_metrics')
      .select('discovered_actions')
      .eq('client_id', id)
      .not('discovered_actions', 'is', null)
      .limit(200),
    activeTab === 'advanced'
      ? db.rpc('get_client_data_coverage', { p_client_id: id }).then(r => r.error ? { data: [] } : r)
      : Promise.resolve({ data: [] }),
    db.from('ad_pause_log').select('*').eq('client_id', id).order('created_at', { ascending: false }).limit(20),
  ])

  const client = clientRes.data as Client | null
  if (!client) notFound()

  // Overview-tab data (contacts, admin users — stats are lazy-loaded client-side)
  const [contactsRes, adminUsersRes] = activeTab === 'overview'
    ? await Promise.all([
        db.from('client_contacts').select('*').eq('client_id', id).order('created_at'),
        db.from('users').select('id, name, email, avatar_url').eq('is_active', true).order('name'),
      ])
    : [{ data: [] }, { data: [] }]

  type ContactRow = { id: string; name: string; email: string | null; phone: string | null; role: string }
  type AdminUserRow = { id: string; name: string; email: string; avatar_url: string | null }

  const contacts   = (contactsRes.data ?? []) as ContactRow[]
  const adminUsers = (adminUsersRes.data ?? []) as AdminUserRow[]

  type CoverageRow = { source: string; min_date: string | null; max_date: string | null; days_with_data: number }
  const SOURCE_LABELS: Record<string, string> = {
    google_ads: 'Google Ads', meta_ads: 'Meta Ads', ga4: 'GA4', gsc: 'Search Console', ahrefs: 'Ahrefs',
    google_analytics: 'GA4', google_search_console: 'Search Console',
    google_business_profile: 'Google Business', ghl: 'GoHighLevel', wordpress: 'WordPress',
  }

  const connections  = (connectionsRes.data ?? []) as (ClientConnection & { connector: Connector })[]
  const pauseLog     = (pauseLogRes.data ?? []) as { id: string; action: string; trigger: string; balance: number | null; google_campaigns_affected: number; meta_campaigns_affected: number; error: string | null; created_at: string }[]
  const connectors   = (connectorsRes.data  ?? []) as Connector[]
  const recentJobs   = (recentJobsRes.data  ?? []) as SyncJob[]
  const coverageRows = ((coverageRes as { data: CoverageRow[] }).data ?? []).filter(r => r.min_date !== null)
  const connTypeByConnectionId = new Map(connections.map(c => [c.id, c.connector.type]))
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
    ai_api_key?: string | null
  } | null
  const aiConfigured = !!(agencySettings?.ai_api_key)
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
  const allBcConns      = connections.filter(c => c.connector.type === 'bigcommerce')
  const contentBcConn   = allBcConns.find(c => (c.connector.config as Record<string, unknown>)?.role !== 'analytics') ?? allBcConns[0]
  const analyticsBcConn = allBcConns.find(c => (c.connector.config as Record<string, unknown>)?.role === 'analytics')

  const connByType = new Map(
    connections
      .filter(c => c.connector.type !== 'bigcommerce')
      .map(c => [c.connector.type, c] as [string, typeof c])
  )
  if (contentBcConn) connByType.set('bigcommerce', contentBcConn)
  const dashUrl        = `${appUrl}/api/auth/access?token=${client.dashboard_token}`
  const adsLibraryUrl  = appUrl ? `${appUrl}/share/ads?token=${client.dashboard_token}` : null

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
          {adsLibraryUrl && <CopyAdLibraryButton url={adsLibraryUrl} />}
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

      {/* ── OVERVIEW ─────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <OverviewTab
          clientId={id}
          name={client.name}
          address={client.address ?? null}
          phone={client.phone ?? null}
          website={client.website ?? null}
          logoUrl={client.logo_url ?? null}
          accountManagerId={client.account_manager_id ?? null}
          adminUsers={adminUsers}
          contacts={contacts}
          dashUrl={dashUrl}
          adsLibraryUrl={adsLibraryUrl}
        />
      )}

      {/* ── DATA SOURCES ─────────────────────────────────────────────── */}
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
                            <Link href="/admin/connections" style={{ color: 'var(--blue)' }}>Set up agency connection first →</Link>
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

          {/* ── Ungrouped flat connector cards ───────────────────── */}
          {UNGROUPED_CONNECTOR_TYPES.map(type => {
            const def         = getConnectorDef(type)
            const connection  = connByType.get(type)
            const connector   = connectors.find(c => c.type === type)
            const implemented = isConnectorImplemented(type)
            const isDirectType = type === 'ghl' || type === 'wordpress' || type === 'bigcommerce'

            const state =
              !implemented ? 'coming-soon'
              : isDirectType
                ? (connection ? 'connected' : 'direct-connect')
                : !connector ? 'connector-missing'
                : connection ? 'connected'
                : 'not-connected'

            const existingDirectTypes = connections
              .filter(c => c.connector.type === 'ghl' || c.connector.type === 'wordpress' || c.connector.type === 'bigcommerce')
              .map(c => c.connector.type as 'ghl' | 'wordpress' | 'bigcommerce')

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
                      <p className="text-xs" style={{ color: 'var(--text-muted)', marginTop: 2 }}>{def.description}</p>
                      {state === 'connector-missing' && (
                        <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                          <Link href="/admin/connections" style={{ color: 'var(--blue)' }}>Set up agency connection first →</Link>
                        </p>
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
                    <ClientDirectConnections clientId={id} existingTypes={existingDirectTypes} singleType={type as 'ghl' | 'wordpress' | 'bigcommerce'} />
                  </div>
                )}
                {type === 'bigcommerce' && state === 'connected' && (
                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                    <ClientBcDailyReport
                      clientId={id}
                      enabled={!!(client as unknown as { bc_daily_report?: boolean }).bc_daily_report}
                      hasDiscord={!!(client as unknown as { discord_channel_id?: string }).discord_channel_id}
                    />
                    <div style={{ marginTop: 12 }}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-2.5 flex-1 min-w-0">
                          <div
                            className="h-7 w-7 rounded flex items-center justify-center flex-shrink-0 text-sm"
                            style={{ background: '#f59e0b18', border: '1px solid #f59e0b30' }}
                          >
                            📦
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Analytics Connection</span>
                              <SourceBadge state={analyticsBcConn ? 'connected' : 'direct-connect'} compact />
                            </div>
                            {analyticsBcConn ? (
                              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                {analyticsBcConn.external_name ?? analyticsBcConn.external_id} — used as primary source for sales reports; falls back to main connection if unavailable.
                              </p>
                            ) : (
                              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                Optional. Add a dedicated connection (e.g. the overseer account) — it will be used first for sales reports with the main connection as fallback.
                              </p>
                            )}
                          </div>
                        </div>
                        {analyticsBcConn && (
                          <Link href={`/admin/clients/${id}/connections/${analyticsBcConn.id}`} className="btn btn-secondary" style={{ padding: '0.25rem 0.625rem', fontSize: '0.75rem', flexShrink: 0 }}>
                            Settings
                          </Link>
                        )}
                      </div>
                      {!analyticsBcConn && (
                        <div style={{ marginTop: 10 }}>
                          <ClientDirectConnections
                            clientId={id}
                            existingTypes={existingDirectTypes}
                            singleType="bigcommerce_analytics"
                            bcAnalyticsConnected={false}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* ── Third-party integration cards ─────────────────────── */}
          <div>
            <ClientIntegrationCards
              clientId={id}
              discordChannelId={(client as unknown as { discord_channel_id?: string }).discord_channel_id ?? null}
              stripeCustomerId={(client as unknown as { stripe_customer_id?: string }).stripe_customer_id ?? null}
              localDominatorUrl={(client as unknown as { local_dominator_url?: string }).local_dominator_url ?? null}
            />
          </div>
        </div>
      )}

      {/* ── PERFORMANCE ──────────────────────────────────────────────── */}
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

      {/* ── CONTENT ──────────────────────────────────────────────────── */}
      {activeTab === 'content' && (
        <ContentTabSection clientId={id} clientName={client.name} isEcom={client.layout_type === 'ecom'} initialSubTab={initialSubTab} />
      )}

      {/* ── BILLING ──────────────────────────────────────────────────── */}
      {activeTab === 'billing' && (
        <BillingTab
          clientId={id}
          adFuelCut={client.ad_fuel_cut ?? null}
          globalCut={globalCut}
        />
      )}

      {/* ── ADVANCED ─────────────────────────────────────────────────── */}
      {activeTab === 'advanced' && (
        <div className="space-y-6 max-w-3xl">

          {/* Client info (name/slug) + logo — moved from old General tab */}
          <div className="card p-5">
            <h2 className="section-title mb-3">Client Info</h2>
            <div className="space-y-4">
              <div>
                <p className="section-desc mb-3">Edit the client name and slug. The slug appears in internal URLs.</p>
                <ClientManualSync clientId={id} />
              </div>
            </div>
          </div>

          {/* Ad Fuel auto-pause (moved from removed Ad Fuel tab) */}
          <div className="card p-5">
            <h2 className="section-title mb-1">Ad Fuel Auto-Pause</h2>
            <p className="section-desc mb-3">Automatically pause and resume campaigns when the Ad Fuel balance runs low.</p>
            <ClientAutoPauseSettings
              clientId={id}
              autoPauseAds={(client as unknown as Record<string, unknown>).auto_pause_ads as boolean ?? false}
              autoResumeAds={(client as unknown as Record<string, unknown>).auto_resume_ads as boolean ?? false}
              campaignsPausedAt={(client as unknown as Record<string, unknown>).campaigns_paused_at as string | null ?? null}
              pauseLog={pauseLog}
            />
          </div>

          {/* Client logo and email schedule removed — logo upload moved to Business Info in Overview tab */}

          {/* Data Coverage */}
          <div className="card p-5">
            <h2 className="section-title mb-1">Data Coverage</h2>
            <p className="section-desc mb-4">Earliest and latest synced dates per source. Gap days = expected calendar days minus days with data.</p>
            {coverageRows.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No synced data yet.</p>
            ) : (
              <table className="data-table w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left">Source</th>
                    <th className="text-left">Earliest</th>
                    <th className="text-left">Latest</th>
                    <th className="text-right">Days w/ Data</th>
                    <th className="text-right">Gap Days</th>
                  </tr>
                </thead>
                <tbody>
                  {coverageRows.map(row => {
                    const fmtDate = (d: string | null) => d
                      ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      : '—'
                    const expectedDays = row.min_date && row.max_date
                      ? Math.round((new Date(row.max_date + 'T00:00:00Z').getTime() - new Date(row.min_date + 'T00:00:00Z').getTime()) / 86_400_000) + 1
                      : null
                    const gapDays = expectedDays !== null ? expectedDays - row.days_with_data : null
                    return (
                      <tr key={row.source}>
                        <td style={{ fontWeight: 500 }}>{SOURCE_LABELS[row.source] ?? row.source}</td>
                        <td>{fmtDate(row.min_date)}</td>
                        <td>{fmtDate(row.max_date)}</td>
                        <td className="text-right">{row.days_with_data.toLocaleString()}</td>
                        <td className="text-right">
                          {gapDays !== null ? (
                            <span className={`badge ${gapDays === 0 ? 'badge-green' : 'badge-amber'}`}>{gapDays}</span>
                          ) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Recent Syncs */}
          {recentJobs.length > 0 && (
            <div className="card p-5">
              <h2 className="section-title mb-3">Recent Syncs</h2>
              <div className="space-y-3">
                {recentJobs.map(job => {
                  const connType = connTypeByConnectionId.get(job.connection_id)
                  const sourceLabel = connType ? (SOURCE_LABELS[connType] ?? connType.replace(/_/g, ' ')) : null
                  const dateRange = job.date_from && job.date_to
                    ? `${new Date(job.date_from + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(job.date_to + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                    : null
                  return (
                    <div key={job.id}>
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-xs" style={{ color: 'var(--text-muted)', minWidth: 120 }}>
                          {new Date(job.started_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </span>
                        {sourceLabel && (
                          <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{sourceLabel}</span>
                        )}
                        {dateRange && (
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{dateRange}</span>
                        )}
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {job.records_synced.toLocaleString()} records
                        </span>
                        <span className={`badge ${job.status === 'success' ? 'badge-green' : job.status === 'error' ? 'badge-red' : 'badge-amber'}`}>
                          {job.status}
                        </span>
                      </div>
                      {job.status === 'error' && job.error_message && (
                        <p className="text-xs mt-1 pl-1" style={{ color: 'var(--red, #dc2626)' }}>
                          ↳ {job.error_message.slice(0, 120)}{job.error_message.length > 120 ? '…' : ''}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="card p-5">
            <h2 className="section-title mb-1">Raw Data Inspector</h2>
            <p className="section-desc mb-4">Browse the raw synced campaign-level data for this client. Useful for diagnosing sync issues.</p>
            <ClientRawData clientId={id} />
          </div>

          <DataPurgeButton clientId={id} clientName={client.name} />
        </div>
      )}
    </div>
  )
}

// ─── Content tab server component ────────────────────────────────────────────

async function ContentTabSection({ clientId, clientName, isEcom, initialSubTab }: { clientId: string; clientName: string; isEcom: boolean; initialSubTab: string }) {
  const db = createAdminClient()

  const windowStart = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10)
  const monthStart  = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)

  const [wpConnData, settingsData, topicsData, recentPostsData, gscRaw, recentKwData, postsData, agencySettingsData] = await Promise.all([
    db.from('client_connections')
      .select('id, external_id, external_name, connector:connectors!inner(type, config)')
      .eq('client_id', clientId).eq('status', 'active').in('connector.type', ['wordpress', 'bigcommerce']),
    db.from('content_settings')
      .select('schedule_frequency, schedule_day_of_week, weeks_ahead, generate_lead_days, publish_time, auto_generate, wizard_completed, business_background, services')
      .eq('client_id', clientId).maybeSingle(),
    db.from('content_topics')
      .select('id, topic, target_keyword, target_publish_date, generate_by_date, status, rationale, keyword_opportunity, ranking_strategy, audience_intent, why_now, competition_level, generation_error, suggested_title, search_volume, keyword_difficulty, created_at')
      .eq('client_id', clientId)
      .in('status', ['pending', 'scheduled', 'approved', 'generating', 'generated'])
      .order('target_publish_date', { ascending: true, nullsFirst: false })
      .limit(200),
    db.from('content_posts')
      .select('id')
      .eq('client_id', clientId)
      .gte('generated_at', monthStart)
      .limit(200),
    db.from('gsc_metrics')
      .select('page, query, impressions, clicks, ctr, position')
      .eq('client_id', clientId)
      .gte('date', windowStart)
      .neq('page', '').neq('query', '').not('page', 'ilike', '%?%'),
    db.from('content_posts')
      .select('target_keyword')
      .eq('client_id', clientId)
      .gte('generated_at', new Date(Date.now() - 90 * 86_400_000).toISOString())
      .limit(60),
    db.from('content_posts')
      .select('id, status, target_keyword, title, word_count, heading_count, internal_links, generated_at, generated_by, published_url, generate_by_date, target_publish_date, wp_post_id, wp_site_url, topic_rationale')
      .eq('client_id', clientId)
      .not('status', 'in', '("published","draft_saved")')
      .order('generated_at', { ascending: false })
      .limit(200),
    db.from('agency_settings').select('ai_api_key').single(),
  ])

  const aiConfigured = !!((agencySettingsData.data as { ai_api_key?: string | null } | null)?.ai_api_key)

  const [
    { count: pendingCount }, { count: approvedCount }, { count: forReviewCount }, { count: publishedCount },
    { count: saPendingCount }, { count: saApprovedCount }, { count: saForReviewCount }, { count: saPublishedCount },
  ] = await Promise.all([
    db.from('content_topics').select('*', { count: 'exact', head: true }).eq('client_id', clientId).in('status', ['pending', 'scheduled']).or('content_type.eq.blog,content_type.is.null'),
    db.from('content_topics').select('*', { count: 'exact', head: true }).eq('client_id', clientId).eq('status', 'approved').or('content_type.eq.blog,content_type.is.null'),
    db.from('content_posts').select('*', { count: 'exact', head: true }).eq('client_id', clientId).eq('status', 'for_review').or('content_type.eq.blog,content_type.is.null'),
    db.from('content_posts').select('*', { count: 'exact', head: true }).eq('client_id', clientId).in('status', ['draft_saved', 'published']).or('content_type.eq.blog,content_type.is.null'),
    db.from('content_topics').select('*', { count: 'exact', head: true }).eq('client_id', clientId).in('status', ['pending', 'scheduled']).eq('content_type', 'service_area'),
    db.from('content_topics').select('*', { count: 'exact', head: true }).eq('client_id', clientId).eq('status', 'approved').eq('content_type', 'service_area'),
    db.from('content_posts').select('*', { count: 'exact', head: true }).eq('client_id', clientId).eq('status', 'for_review').eq('content_type', 'service_area'),
    db.from('content_posts').select('*', { count: 'exact', head: true }).eq('client_id', clientId).in('status', ['draft_saved', 'published']).eq('content_type', 'service_area'),
  ])

  type WpConn = { id: string; external_id: string; external_name: string | null; connector: { type: string; config: Record<string, unknown> } }
  const sites = ((wpConnData.data ?? []) as unknown as WpConn[]).map(c => ({
    connectionId:  c.id,
    connectorType: c.connector.type,
    siteUrl:       c.external_id || String((c.connector.config as Record<string, string>).site_url ?? ''),
    siteName:      c.external_name || (() => { try { return new URL(c.external_id || '').hostname } catch { return c.external_id || 'unknown' } })(),
    clientId,
    clientName,
  }))

  type TopicRow = {
    id: string; topic: string; target_keyword: string | null; target_publish_date: string | null
    generate_by_date: string | null; status: string; rationale: string | null
    keyword_opportunity: string | null; ranking_strategy: string | null; audience_intent: string | null
    why_now: string | null; competition_level: string | null; generation_error: string | null
    suggested_title: string | null; search_volume: number | null; keyword_difficulty: number | null
    created_at: string
  }
  const upcomingTopics    = (topicsData.data ?? []) as TopicRow[]
  const nextPublishDate   = upcomingTopics.find(t => ['pending','scheduled','approved','generating'].includes(t.status))?.target_publish_date ?? null
  const recentPostsCount  = (recentPostsData.data ?? []).length

  type AggRow = { page: string; query: string; impressions: number; clicks: number; weightedPos: number; weightedCtr: number }
  const agg = new Map<string, AggRow>()
  for (const r of (gscRaw.data ?? []) as { page: string; query: string; impressions: number; clicks: number; ctr: number; position: number }[]) {
    if (!r.page || !r.query) continue
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
      agg.set(key, { page: r.page, query: r.query, impressions: impr, clicks: r.clicks ?? 0, weightedPos: r.position ?? 0, weightedCtr: r.ctr ?? 0 })
    }
  }

  const recentKeywords = new Set(
    (recentKwData.data ?? []).map(p => ((p as { target_keyword?: string }).target_keyword ?? '').toLowerCase().trim()).filter(Boolean)
  )

  const aggRows = Array.from(agg.values()).map(r => ({
    page: r.page, query: r.query, impressions: r.impressions, clicks: r.clicks,
    ctr: r.weightedCtr, position: r.weightedPos,
    recentlyTargeted: recentKeywords.has(r.query.toLowerCase().trim()),
  }))

  const sortSection = (rows: typeof aggRows, limit: number) =>
    [...rows].sort((a, b) => {
      if (a.recentlyTargeted !== b.recentlyTargeted) return a.recentlyTargeted ? 1 : -1
      return b.impressions - a.impressions
    }).slice(0, limit)

  const gscData: GscData = {
    quickWins:  sortSection(aggRows.filter(r => r.position >= 5  && r.position <= 10 && r.impressions > 5  && r.ctr < 0.15), 50),
    growth:     sortSection(aggRows.filter(r => r.position > 10  && r.position <= 20 && r.impressions > 3), 50),
    lowCtr:     sortSection(aggRows.filter(r => r.position >= 1  && r.position <= 5  && r.impressions > 8  && r.ctr < 0.06), 50),
    highVolume: sortSection(aggRows.filter(r => r.position > 20  && r.impressions > 20), 50),
  }

  const topicQueueItems = upcomingTopics.map(t => ({
    type:               'topic' as const,
    id:                 t.id,
    clientId,
    clientName,
    status:             t.status,
    targetKeyword:      t.target_keyword ?? null,
    title:              null,
    topicText:          t.topic,
    wordCount:          null,
    headingCount:       null,
    internalLinks:      null,
    generatedAt:        t.created_at,
    generatedBy:        'scheduled',
    publishedUrl:       null,
    generateByDate:     t.generate_by_date ?? null,
    targetPublishDate:  t.target_publish_date ?? null,
    rationale:          t.rationale ?? null,
    wpPostId:           null,
    wpSiteUrl:          null,
    keywordOpportunity: t.keyword_opportunity ?? null,
    rankingStrategy:    t.ranking_strategy ?? null,
    audienceIntent:     t.audience_intent ?? null,
    whyNow:             t.why_now ?? null,
    competitionLevel:   t.competition_level ?? null,
    generationError:    t.generation_error ?? null,
    suggestedTitle:     t.suggested_title ?? null,
    searchVolume:       t.search_volume ?? null,
    keywordDifficulty:  t.keyword_difficulty ?? null,
  }))

  const posts = [
    ...topicQueueItems,
    ...(postsData.data ?? []).map(p => {
      type P = Record<string, unknown>
      const r = p as P
      return {
        type:             'post' as const,
        id:               String(r.id),
        clientId,
        clientName,
        status:           String(r.status),
        targetKeyword:    r.target_keyword ? String(r.target_keyword) : null,
        title:            r.title         ? String(r.title)          : null,
        topicText:        null,
        wordCount:        r.word_count     != null ? Number(r.word_count)    : null,
        headingCount:     r.heading_count  != null ? Number(r.heading_count) : null,
        internalLinks:    r.internal_links != null ? Number(r.internal_links): null,
        generatedAt:      String(r.generated_at),
        generatedBy:      String(r.generated_by ?? ''),
        publishedUrl:     r.published_url  ? String(r.published_url)  : null,
        generateByDate:   r.generate_by_date ? String(r.generate_by_date) : null,
        targetPublishDate:r.target_publish_date ? String(r.target_publish_date) : null,
        rationale:        r.topic_rationale ? String(r.topic_rationale) : null,
        wpPostId:         r.wp_post_id     ? Number(r.wp_post_id)   : null,
        wpSiteUrl:        r.wp_site_url    ? String(r.wp_site_url)  : null,
      }
    }),
  ]

  return (
    <Suspense fallback={null}>
      <ClientContentTabPanel
        clientId={clientId}
        clientName={clientName}
        isEcom={isEcom}
        sites={sites}
        contentSettings={settingsData.data as Record<string, unknown> | null}
        aiConfigured={aiConfigured}
        overviewStats={{
          upcomingTopicsCount: upcomingTopics.filter(t => ['pending','scheduled','approved','generating'].includes(t.status)).length,
          nextPublishDate,
          recentPostsCount,
          pendingTopicsCount:    pendingCount    ?? 0,
          approvedTopicsCount:   approvedCount   ?? 0,
          forReviewPostsCount:   forReviewCount  ?? 0,
          publishedPostsCount:   publishedCount  ?? 0,
          saPendingTopicsCount:  saPendingCount  ?? 0,
          saApprovedTopicsCount: saApprovedCount ?? 0,
          saForReviewPostsCount: saForReviewCount ?? 0,
          saPublishedPostsCount: saPublishedCount ?? 0,
        }}
        gscData={gscData}
        initialSubTab={initialSubTab}
      />
    </Suspense>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SourceBadge({ state, compact = false }: { state: string; compact?: boolean }) {
  if (state === 'connected') {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        padding: compact ? '1px 5px' : '1px 8px',
        borderRadius: 999, fontSize: compact ? '0.6rem' : '0.7rem', fontWeight: 600,
        background: '#dcfce7', color: '#166534',
      }}>
        ✓ Connected
      </span>
    )
  }
  const m: Record<string, { label: string; cls: string }> = {
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
