// Client Detail — /admin/clients/[id]
// Tabbed management page: Overview / Integrations / Metrics / Content / Billing / Advanced

import { unstable_noStore as noStore } from 'next/cache'
import { Suspense } from 'react'
import { createAdminClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Client, ClientConnection, Connector, SyncJob, ClientTemperature } from '@/lib/types'
import {
  GOOGLE_CONNECTOR_TYPES,
  getConnectorDef,
  isConnectorImplemented,
} from '@/lib/connectors/registry'
import { DEFAULT_SETTINGS } from '@/lib/agency-settings'
import ClientSyncButton from './ClientSyncButton'
import ClientManualSync from './ClientManualSync'
import DataPurgeButton from './DataPurgeButton'
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
import PageHeader from '@/components/ui/PageHeader'
import Section from '@/components/ui/Section'
import StatusBadge from '@/components/ui/StatusBadge'
import BrandLogo from '@/components/ui/BrandLogo'
import { RouteTabs } from '@/components/ui/PillTabs'
import ClientLinksMenu from '@/components/admin/ClientLinksMenu'
import IntegrationRow, { IntegrationGroup } from '@/components/admin/integrations/IntegrationRow'
import { CLIENT_TAB_SKELETONS } from './ClientSkeletons'
import { PresentationChart } from '@phosphor-icons/react/dist/ssr'

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
  const initialSubTab = sp.subtab ?? 'pipeline'
  const db = createAdminClient()

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
    db.from('agency_settings').select('ad_fuel_cut,default_lead_action,default_purchase_action,benchmark_roas,benchmark_ctr,benchmark_cpc,benchmark_conv_rate,benchmark_cpm,benchmark_cpl,metric_layouts,ai_api_key,contact_stale_days').single(),
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
    contact_stale_days?: number | null
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
  const allBcConns      = connections.filter(c => c.connector.type === 'bigcommerce')
  const contentBcConn   = allBcConns.find(c => (c.connector.config as Record<string, unknown>)?.role !== 'analytics') ?? allBcConns[0]
  const analyticsBcConn = allBcConns.find(c => (c.connector.config as Record<string, unknown>)?.role === 'analytics')

  const connByType = new Map(
    connections
      .filter(c => c.connector.type !== 'bigcommerce')
      .map(c => [c.connector.type, c] as [string, typeof c])
  )
  if (contentBcConn) connByType.set('bigcommerce', contentBcConn)

  function tabUrl(tab: string) {
    return `/admin/clients/${id}?tab=${tab}`
  }

  return (
    <div>
      <PageHeader
        back={{ href: '/admin/dashboard', label: 'Clients' }}
        title={client.name}
        description={client.website ? client.website.replace(/^https?:\/\//, '').replace(/\/$/, '') : undefined}
        leading={client.logo_url
          ? <span className="ui-tile ui-tile--xl ui-tile--logo"><img src={client.logo_url} alt="" style={{ padding: 4 }} /></span>
          : <span className="ui-tile ui-tile--xl ui-tile--accent" style={{ fontSize: '1.125rem', fontWeight: 700 }} aria-hidden>{client.name.charAt(0).toUpperCase()}</span>}
        actions={<>
          <Link href={`/api/admin/preview/${id}`} className="btn btn-secondary"><PresentationChart size={16} aria-hidden />Preview dashboard</Link>
          <ClientLinksMenu clientId={id} clientName={client.name} dashboardToken={client.dashboard_token} />
        </>}
      />

      {sp.connected && <div className="ui-notice ui-notice--success" role="status">{sp.connected.replace(/_/g, ' ')} connected.</div>}
      {sp.synced    && <div className="ui-notice ui-notice--success" role="status">Sync complete.</div>}
      {sp.error     && <div className="ui-notice ui-notice--danger" role="alert">{sp.error.replace(/_/g, ' ')}</div>}

      <RouteTabs
        label="Client sections"
        activeId={activeTab}
        items={TABS.map(t => ({ id: t.id, label: t.label, href: tabUrl(t.id) }))}
        pending={CLIENT_TAB_SKELETONS}
      >
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
          temperature={(client as unknown as { temperature?: ClientTemperature | null }).temperature ?? null}
          lastContactedAt={(client as unknown as { last_contacted_at?: string | null }).last_contacted_at ?? null}
          contactStaleDays={(client as unknown as { contact_stale_days?: number | null }).contact_stale_days ?? null}
          agencyStaleDays={agencySettings?.contact_stale_days ?? 14}
          adminUsers={adminUsers}
          contacts={contacts}
          dashboardToken={client.dashboard_token}
        />
      )}

      {/* ── INTEGRATIONS ─────────────────────────────────────────────── */}
      {/* The same rows as the agency Integrations page. Account-based services (Google, Meta,
          Ahrefs, DataForSEO) get an account assigned from the agency's connection; site and CRM
          connections (WordPress, HighLevel, BigCommerce) connect here with their own details;
          notifications and billing are per-client IDs. Every change refreshes the page in place. */}
      {activeTab === 'sources' && (() => {
        const fmtSynced = (d: string | null | undefined) => d
          ? `synced ${new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
          : 'not synced yet'

        /** A row for a service whose account comes from the agency connection. */
        const assignedRow = (type: string, opts: { sub?: boolean } = {}) => {
          const def        = getConnectorDef(type as Parameters<typeof getConnectorDef>[0])
          const connection = connByType.get(type)
          const connector  = connectors.find(c => c.type === type)
          return (
            <IntegrationRow
              key={type}
              sub={opts.sub}
              brand={type}
              name={def.label}
              description={opts.sub ? undefined : def.description}
              status={connection
                ? { tone: connection.status === 'active' ? 'success' : 'warning', label: connection.status === 'active' ? 'Connected' : connection.status.charAt(0).toUpperCase() + connection.status.slice(1) }
                : connector ? { tone: 'neutral', label: 'Not assigned' }
                : { tone: 'warning', label: 'Agency not connected', title: 'Connect this service on the agency Integrations page first.' }}
              meta={connection ? `${connection.external_name ?? connection.external_id}, ${fmtSynced(connection.last_synced_at)}` : undefined}
              actions={connection
                ? <>
                    <ClientSyncButton clientId={id} connectionId={connection.id} />
                    <Link href={`/admin/clients/${id}/connections/${connection.id}`} className="btn btn-ghost btn-sm">Settings</Link>
                  </>
                : connector
                  ? <Link href={`/admin/clients/${id}/connections/new?connector=${connector.id}`} className="btn btn-secondary btn-sm">Assign account</Link>
                  : <Link href="/admin/connections" className="btn btn-ghost btn-sm">Set up</Link>}
            />
          )
        }

        const existingDirectTypes = connections
          .filter(c => c.connector.type === 'ghl' || c.connector.type === 'wordpress' || c.connector.type === 'bigcommerce')
          .map(c => c.connector.type as 'ghl' | 'wordpress' | 'bigcommerce')

        /** A site or CRM connection: connected → its row; not → the connect row from ClientDirectConnections. */
        const directRow = (type: 'wordpress' | 'ghl' | 'bigcommerce') => {
          const connection = connByType.get(type)
          if (!connection) {
            return <ClientDirectConnections key={type} clientId={id} existingTypes={existingDirectTypes} singleType={type} />
          }
          const def = getConnectorDef(type)
          return (
            <IntegrationRow
              key={type}
              brand={type}
              name={type === 'ghl' ? 'HighLevel' : def.label}
              status={{ tone: connection.status === 'active' ? 'success' : 'warning', label: connection.status === 'active' ? 'Connected' : connection.status.charAt(0).toUpperCase() + connection.status.slice(1) }}
              description={def.description}
              meta={`${connection.external_name ?? connection.external_id}, ${fmtSynced(connection.last_synced_at)}`}
              actions={<>
                <ClientSyncButton clientId={id} connectionId={connection.id} />
                <Link href={`/admin/clients/${id}/connections/${connection.id}`} className="btn btn-ghost btn-sm">Settings</Link>
              </>}
            >
              {type === 'bigcommerce' && (
                <>
                  <ClientBcDailyReport
                    clientId={id}
                    enabled={!!(client as unknown as { bc_daily_report?: boolean }).bc_daily_report}
                    hasDiscord={!!(client as unknown as { discord_channel_id?: string }).discord_channel_id}
                  />
                  {analyticsBcConn ? (
                    <IntegrationRow
                      sub
                      brand="bigcommerce_analytics"
                      name="Analytics connection"
                      status={{ tone: 'success', label: 'Connected' }}
                      meta={`${analyticsBcConn.external_name ?? analyticsBcConn.external_id}. Used first for sales reports; the main connection is the fallback.`}
                      actions={<Link href={`/admin/clients/${id}/connections/${analyticsBcConn.id}`} className="btn btn-ghost btn-sm">Settings</Link>}
                    />
                  ) : (
                    <ClientDirectConnections clientId={id} existingTypes={existingDirectTypes} singleType="bigcommerce_analytics" bcAnalyticsConnected={false} />
                  )}
                </>
              )}
            </IntegrationRow>
          )
        }

        const googleAssigned = GOOGLE_CONNECTOR_TYPES.filter(t => connByType.get(t)).length
        const implemented = (t: string) => isConnectorImplemented(t as Parameters<typeof isConnectorImplemented>[0])

        return (
          <div style={{ maxWidth: 900 }}>
            <IntegrationGroup id="ci-ads" title="Ads and analytics" description="Accounts from the agency's Google and Meta connections.">
              <IntegrationRow
                brand="google"
                name="Google"
                status={googleAssigned === 0
                  ? { tone: 'neutral', label: 'Nothing assigned' }
                  : { tone: googleAssigned === GOOGLE_CONNECTOR_TYPES.length ? 'success' : 'info', label: `${googleAssigned} of ${GOOGLE_CONNECTOR_TYPES.length} assigned` }}
                description="Ads, Analytics, Search Console and Business Profile. Assign each account below."
              >
                {GOOGLE_CONNECTOR_TYPES.map(t => assignedRow(t, { sub: true }))}
              </IntegrationRow>
              {implemented('meta_ads') && assignedRow('meta_ads')}
            </IntegrationGroup>

            <IntegrationGroup id="ci-site" title="Website and CRM" description="Where posts publish, and where leads and calls come from.">
              {(['wordpress', 'ghl', 'bigcommerce'] as const).filter(implemented).map(directRow)}
            </IntegrationGroup>

            <IntegrationGroup id="ci-seo" title="SEO data" description="Rankings and keyword research for this client's site.">
              {(['ahrefs', 'dataforseo'] as const).filter(implemented).map(t => assignedRow(t))}
            </IntegrationGroup>

            <IntegrationGroup id="ci-ops" title="Notifications and billing" description="Where this client's alerts go, and how their payments and maps are linked.">
              <ClientIntegrationCards
                clientId={id}
                discordChannelId={(client as unknown as { discord_channel_id?: string }).discord_channel_id ?? null}
                stripeCustomerId={(client as unknown as { stripe_customer_id?: string }).stripe_customer_id ?? null}
                localDominatorUrl={(client as unknown as { local_dominator_url?: string }).local_dominator_url ?? null}
              />
            </IntegrationGroup>
          </div>
        )
      })()}

      {/* ── PERFORMANCE ──────────────────────────────────────────────── */}
      {activeTab === 'performance' && (
        <div className="ui-stack" style={{ maxWidth: 820 }}>
          <Section title="Performance benchmarks" description="Show benchmarks on the client's dashboard, and override the agency targets for this client.">
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
          </Section>

          <Section title="Dashboard layout" description="The layout type, which metrics show and in what order, and which sections are visible.">
            <ClientMetricVisibility
              clientId={id}
              initialHidden={Array.isArray(client.hidden_metrics) ? client.hidden_metrics : []}
              initialLayoutType={client.layout_type ?? null}
              initialLayoutOverride={(client.metric_layout_override as MetricLayouts | null) ?? null}
              agencyLayouts={(agencySettings?.metric_layouts as MetricLayouts | null) ?? null}
            />
          </Section>

          <Section title="Campaigns" description="Whether each campaign reports as lead gen or ecommerce, and whether it shows on the dashboard.">
            <ClientCampaignManager clientId={id} />
          </Section>

          <Section title="Conversion mapping" description="Which Meta actions count as conversions for lead gen and ecommerce campaigns.">
            <ClientConversionMapping
              clientId={id}
              leadAction={clientWithActions.lead_action ?? null}
              purchaseAction={clientWithActions.purchase_action ?? null}
              agencyLeadAction={agencyLead}
              agencyPurchaseAction={agencyPurch}
              discoveredActions={discoveredActions}
            />
          </Section>
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
        <div className="ui-stack" style={{ maxWidth: 820 }}>

          <Section title="Sync data" description="Pull recent days again, or backfill up to two years of history.">
            <ClientManualSync clientId={id} />
          </Section>

          <Section title="Ad Fuel auto-pause" description="Pause campaigns when the Ad Fuel balance runs out, and resume them when it's topped up.">
            <ClientAutoPauseSettings
              clientId={id}
              autoPauseAds={(client as unknown as Record<string, unknown>).auto_pause_ads as boolean ?? false}
              autoResumeAds={(client as unknown as Record<string, unknown>).auto_resume_ads as boolean ?? false}
              campaignsPausedAt={(client as unknown as Record<string, unknown>).campaigns_paused_at as string | null ?? null}
              pauseLog={pauseLog}
            />
          </Section>

          <Section title="Data coverage" description="The first and last day synced for each source. Gaps are days in between with no data." flush>
            {coverageRows.length === 0 ? (
              <p className="ui-row-sub" style={{ padding: '0 20px 20px' }}>No data synced yet.</p>
            ) : (
              <div className="ui-scroll-x">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>First day</th>
                    <th>Last day</th>
                    <th className="ui-r">Days with data</th>
                    <th className="ui-r">Gaps</th>
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
                        <td className="ui-strong">{SOURCE_LABELS[row.source] ?? row.source}</td>
                        <td>{fmtDate(row.min_date)}</td>
                        <td>{fmtDate(row.max_date)}</td>
                        <td className="ui-r">{row.days_with_data.toLocaleString()}</td>
                        <td className="ui-r">
                          {gapDays !== null ? (
                            <StatusBadge tone={gapDays === 0 ? 'success' : 'warning'} dot={false}>{gapDays === 0 ? 'None' : gapDays}</StatusBadge>
                          ) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
            )}
          </Section>

          {recentJobs.length > 0 && (
            <Section title="Recent syncs" description="The last 20 syncs for this client, newest first." flush>
              <div>
                {recentJobs.map(job => {
                  const connType = connTypeByConnectionId.get(job.connection_id)
                  const sourceLabel = connType ? (SOURCE_LABELS[connType] ?? connType.replace(/_/g, ' ')) : null
                  const dateRange = job.date_from && job.date_to
                    ? `${new Date(job.date_from + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(job.date_to + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                    : null
                  return (
                    <div key={job.id} className="ui-row">
                      {connType ? <BrandLogo type={connType} size={16} tile tileSize="sm" /> : <span className="ui-tile ui-tile--sm" />}
                      <span className="ui-row-text">
                        <span className="ui-row-title">
                          {sourceLabel ?? 'Sync'}
                          <StatusBadge tone={job.status === 'success' ? 'success' : job.status === 'error' ? 'danger' : 'warning'}>
                            {job.status === 'success' ? 'Done' : job.status === 'error' ? 'Failed' : job.status.charAt(0).toUpperCase() + job.status.slice(1)}
                          </StatusBadge>
                        </span>
                        <span className="ui-row-sub">
                          {new Date(job.started_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          {dateRange ? `, data for ${dateRange}` : ''}
                          {`, ${job.records_synced.toLocaleString()} records`}
                        </span>
                        {job.status === 'error' && job.error_message && (
                          <span className="ui-row-sub" style={{ color: 'var(--red-fg)' }}>
                            {job.error_message.slice(0, 160)}{job.error_message.length > 160 ? '…' : ''}
                          </span>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            </Section>
          )}

          <Section title="Raw data" description="The synced campaign-level rows as stored, for tracking down a sync problem.">
            <ClientRawData clientId={id} />
          </Section>

          <DataPurgeButton clientId={id} clientName={client.name} />
        </div>
      )}
      </RouteTabs>
    </div>
  )
}

// ─── Content tab server component ────────────────────────────────────────────

async function ContentTabSection({ clientId, clientName, isEcom, initialSubTab }: { clientId: string; clientName: string; isEcom: boolean; initialSubTab: string }) {
  const db = createAdminClient()

  const windowStart = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10)
  const monthStart  = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)

  const [wpConnData, settingsData, topicsData, recentPostsData, gscRaw, recentKwData, agencySettingsData] = await Promise.all([
    db.from('client_connections')
      .select('id, external_id, external_name, connector:connectors!inner(type, config)')
      .eq('client_id', clientId).eq('status', 'active').in('connector.type', ['wordpress', 'bigcommerce']),
    db.from('content_settings')
      // schedule_start_date and monthly_publish_day are load-bearing, not extras: without them
      // ClientPipeline's start-date field falls back to today() on every render, so a client
      // with a plan running from 1 August showed "today" and looked unconfigured. Anyone
      // correcting that apparent mistake was really MOVING the anchor.
      .select('schedule_frequency, schedule_day_of_week, weeks_ahead, generate_lead_days, publish_time, auto_generate, wizard_completed, business_background, services, schedule_start_date, monthly_publish_day, posts_per_run')
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

