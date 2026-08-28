// Integrations — /admin/connections
// Agency-level management of all data source connectors + Stripe.
//
// Google connectors (Ads, Analytics, Search Console, Business Profile) are
// displayed as a single grouped card — one OAuth flow connects all four.
// All other connectors (Meta, Ahrefs, GHL, WordPress) remain as flat cards.
// Stripe agency credentials are managed here too.

import { createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'
import {
  GOOGLE_CONNECTOR_TYPES,
  UNGROUPED_CONNECTOR_TYPES,
  getConnectorDef,
  isConnectorImplemented,
} from '@/lib/connectors/registry'
import { GoogleAdsLogo, GALogo, GSCLogo } from '@/components/ConnectorLogo'
import type { Connector } from '@/lib/types'
import type { ConnectorType } from '@/lib/types'
import StripeAgencyCard     from '@/components/admin/StripeAgencyCard'
import AhrefsAgencyCard     from '@/components/admin/AhrefsAgencyCard'
import DataForSeoAgencyCard from '@/components/admin/DataForSeoAgencyCard'
import DataForSeoUsagePanel from '@/components/admin/DataForSeoUsagePanel'
import SearchApiAgencyCard  from '@/components/admin/SearchApiAgencyCard'
import { resolveDfsCreds }  from '@/lib/connectors/dataforseo'
import type { SeoDevice }   from '@/lib/connectors/dataforseo'
import DiscordAgencyCard    from '@/components/admin/DiscordAgencyCard'
import { SECRET_MASK }      from '@/lib/secretMask'
import GoogleRefreshButton  from '@/components/admin/GoogleRefreshButton'

export const dynamic = 'force-dynamic'

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>
}) {
  const sp = await searchParams
  const db = createAdminClient()
  const [connectorsRes, agencyRes] = await Promise.all([
    db.from('connectors').select('*').order('created_at'),
    db.from('agency_settings')
      .select('stripe_api_key, stripe_webhook_secret, serp_api_key, serp_api_provider, discord_bot_token, discord_ops_channel_id')
      .single(),
  ])
  const existing = (connectorsRes.data ?? []) as Connector[]
  const agencySettings = agencyRes.data as {
    stripe_api_key?: string; stripe_webhook_secret?: string
    serp_api_key?: string; serp_api_provider?: string
    discord_bot_token?: string; discord_ops_channel_id?: string
  } | null

  // Ahrefs connector (if any)
  const ahrefsConnector = existing.find(c => c.type === 'ahrefs')
  const ahrefsApiKey    = ahrefsConnector ? String((ahrefsConnector.auth as Record<string, unknown>)?.api_key ?? '') : ''

  // DataForSEO connector (if any)
  const dfsConnector = existing.find(c => c.type === 'dataforseo')
  const dfsAuth      = (dfsConnector?.auth as Record<string, unknown> | undefined) ?? {}
  const dfsConfig    = (dfsConnector?.config as Record<string, unknown> | undefined) ?? {}
  // Must match resolveDfsCreds exactly (login AND password, or a decodable api_key; env fills
  // gaps). A login-only save is NOT usable, so don't render "Credentials set" + the usage panel
  // for creds that resolveDfsCreds would reject everywhere they're actually used.
  const dfsHasCreds  = resolveDfsCreds(dfsAuth) !== null
  const dfsDevices   = Array.isArray(dfsConfig.devices) ? (dfsConfig.devices as SeoDevice[]) : undefined
  const dfsDepth     = typeof dfsConfig.rank_depth === 'number' ? dfsConfig.rank_depth : undefined

  // Map type → existing connector for quick lookup
  const byType = new Map(existing.map(c => [c.type, c]))

  // Google group status
  const googleConns = GOOGLE_CONNECTOR_TYPES.map(t => byType.get(t)).filter(Boolean) as Connector[]
  const googleStatus: 'none' | 'partial' | 'full' =
    googleConns.length === 0                        ? 'none'
    : googleConns.length === GOOGLE_CONNECTOR_TYPES.length ? 'full'
    : 'partial'

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Integrations</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Connect the agency to external data sources and third-party services. Once connected, assign accounts to clients.
          </p>
        </div>
      </div>

      {/* OAuth result notices */}
      {sp.connected === 'google' && (
        <div className="mb-4 rounded-xl px-4 py-3 text-sm" style={{ background: 'var(--green-subtle, #f0fdf4)', border: '1px solid var(--green-border, #bbf7d0)', color: 'var(--green)' }}>
          Google account connected — all four data sources are now active.
        </div>
      )}
      {sp.error === 'google_auth_failed' && (
        <div className="mb-4 rounded-xl px-4 py-3 text-sm" style={{ background: 'var(--red-subtle)', border: '1px solid #fecaca', color: 'var(--red)' }}>
          Google sign-in was cancelled or denied. Try again, or check that your Google account has access to the required data.
        </div>
      )}
      {sp.error === 'google_failed' && (
        <div className="mb-4 rounded-xl px-4 py-3 text-sm" style={{ background: 'var(--red-subtle)', border: '1px solid #fecaca', color: 'var(--red)' }}>
          Google connection failed. Check Vercel function logs for details (<code>/api/auth/google/callback</code>).
        </div>
      )}
      {sp.error === 'google_save_failed' && (
        <div className="mb-4 rounded-xl px-4 py-3 text-sm" style={{ background: 'var(--red-subtle)', border: '1px solid #fecaca', color: 'var(--red)' }}>
          Google tokens were received but could not be saved to the database. Check Vercel logs.
        </div>
      )}
      {sp.connected === 'meta' && (
        <div className="mb-4 rounded-xl px-4 py-3 text-sm" style={{ background: 'var(--green-subtle, #f0fdf4)', border: '1px solid var(--green-border, #bbf7d0)', color: 'var(--green)' }}>
          Meta Ads reconnected successfully — your 60-day token has been refreshed.
        </div>
      )}
      {sp.error === 'meta_auth_failed' && (
        <div className="mb-4 rounded-xl px-4 py-3 text-sm" style={{ background: 'var(--red-subtle)', border: '1px solid #fecaca', color: 'var(--red)' }}>
          Meta sign-in was cancelled or denied. Try reconnecting from the Meta Ads connector settings.
        </div>
      )}
      {(sp.error === 'meta_save_failed' || sp.error === 'meta_failed') && (
        <div className="mb-4 rounded-xl px-4 py-3 text-sm" style={{ background: 'var(--red-subtle)', border: '1px solid #fecaca', color: 'var(--red)' }}>
          Meta connection failed — the token was received but could not be saved. Check Vercel function logs (<code>/api/auth/meta/callback</code>).
        </div>
      )}

      <div className="space-y-3">

        {/* ── Google Group Card ──────────────────────────────────────────────── */}
        <div className="card p-5">
          {/* Header row */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div
                className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
                style={{ background: '#4285F4' }}
              >
                G
              </div>
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Google
                  </h2>
                  <GoogleGroupBadge status={googleStatus} count={googleConns.length} total={GOOGLE_CONNECTOR_TYPES.length} />
                </div>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  One Google sign-in powers Ads, Analytics, Search Console &amp; Business Profile.
                </p>
              </div>
            </div>

            <div className="flex-shrink-0 flex items-center gap-2">
              {googleStatus !== 'none' && <GoogleRefreshButton />}
              {googleStatus === 'none' ? (
                <Link href="/admin/connections/new?type=google" className="btn btn-primary">
                  Connect Google Account
                </Link>
              ) : (
                <a href="/api/auth/google/start" className="btn btn-secondary">
                  Reconnect Account
                </a>
              )}
            </div>
          </div>

          {/* Sub-rows — only shown when at least one Google connector exists */}
          {googleStatus !== 'none' && (
            <div
              className="mt-4 pt-4 space-y-1"
              style={{ borderTop: '1px solid var(--border)' }}
            >
              {GOOGLE_CONNECTOR_TYPES.map(type => {
                const connector = byType.get(type)
                const def = getConnectorDef(type)
                const status = connector?.status ?? 'disconnected'
                const missingDevToken =
                  type === 'google_ads' && connector &&
                  !((connector.auth as Record<string, unknown>)?.developer_token)

                return (
                  <div
                    key={type}
                    className="flex items-center justify-between gap-3 rounded-lg px-3 py-2"
                    style={{ background: 'var(--bg-subtle)' }}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {/* Small logo */}
                      <div
                        className="h-6 w-6 rounded flex items-center justify-center flex-shrink-0"
                        style={{ background: `${def.color}18`, border: `1px solid ${def.color}30` }}
                      >
                        <GoogleSubLogo type={type} size={14} />
                      </div>
                      <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {def.label}
                      </span>
                      {connector
                        ? <ConnectorStatusBadge status={status} />
                        : <span className="badge badge-gray">Not connected</span>
                      }
                      {missingDevToken && (
                        <span
                          className="text-xs"
                          style={{ color: '#f59e0b' }}
                          title="Developer token missing — Google Ads sync will fail. Configure to fix."
                        >
                          ⚠ No dev token
                        </span>
                      )}
                    </div>
                    {connector && (
                      <Link
                        href={`/admin/connections/${connector.id}`}
                        className="btn btn-secondary flex-shrink-0"
                        style={{ padding: '0.25rem 0.625rem', fontSize: '0.75rem' }}
                      >
                        Configure
                      </Link>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Ungrouped flat cards (agency-level only) ───────────────────────── */}
        {UNGROUPED_CONNECTOR_TYPES
          .filter(type => type !== 'ghl' && type !== 'wordpress' && type !== 'bigcommerce' && type !== 'ahrefs' && type !== 'dataforseo')
          .map(type => {
            const def         = getConnectorDef(type)
            const connector   = byType.get(type)
            const implemented = isConnectorImplemented(type)
            const status      = connector?.status ?? 'disconnected'

            return (
              <div key={type} className="card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div
                      className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
                      style={{ background: def.color }}
                    >
                      {def.icon}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {def.label}
                        </h2>
                        {connector && <ConnectorStatusBadge status={status} />}
                        {!implemented && (
                          <span className="badge badge-gray">Coming soon</span>
                        )}
                      </div>
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        {def.description}
                      </p>
                      {connector && (
                        <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                          {connector.label || 'No label set'}
                          {connector.last_checked_at && ` · Last checked ${new Date(connector.last_checked_at).toLocaleDateString()}`}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex-shrink-0">
                    {!implemented ? (
                      <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                        Not yet available
                      </span>
                    ) : connector ? (
                      <Link href={`/admin/connections/${connector.id}`} className="btn btn-secondary">
                        Configure
                      </Link>
                    ) : (
                      <Link href={`/admin/connections/new?type=${type}`} className="btn btn-primary">
                        Connect
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

        {/* ── Ahrefs ────────────────────────────────────────────────────────── */}
        <AhrefsAgencyCard
          initialApiKey={ahrefsApiKey}
          connectorId={ahrefsConnector?.id}
        />
        {/* ── DataForSEO (keyword rank tracking) ────────────────────────────── */}
        <DataForSeoAgencyCard
          connectorId={dfsConnector?.id}
          connected={dfsConnector?.status === 'active'}
          hasCreds={dfsHasCreds}
          initialDepth={dfsDepth}
          initialDevices={dfsDevices}
        />
        {/* DataForSEO usage + spend (only once credentials exist) */}
        {dfsHasCreds && <DataForSeoUsagePanel />}
        {/* ── Search API (SerpAPI — competitor research) ────────────────────── */}
        <SearchApiAgencyCard
          initialApiKey={agencySettings?.serp_api_key ? SECRET_MASK : ''}
          initialProvider={agencySettings?.serp_api_provider ?? 'serpapi'}
        />
        {/* ── Discord (agency notifications) ────────────────────────────────── */}
        <DiscordAgencyCard
          initialBotToken={agencySettings?.discord_bot_token ? SECRET_MASK : ''}
          initialOpsChannelId={agencySettings?.discord_ops_channel_id ?? ''}
        />
        {/* ── Stripe ────────────────────────────────────────────────── */}
        <StripeAgencyCard
          initialApiKey={agencySettings?.stripe_api_key ? SECRET_MASK : ''}
          initialWebhookSecret={agencySettings?.stripe_webhook_secret ? SECRET_MASK : ''}
        />

      </div>

      {/* Info box */}
      <div
        className="mt-6 rounded-xl p-4 text-sm"
        style={{ background: 'var(--blue-subtle)', border: '1px solid var(--blue-border)', color: 'var(--blue)' }}
      >
        <strong>How connections work:</strong> Connect each platform once at the agency level.
        Then go to <Link href="/admin/clients" style={{ color: 'var(--blue)', textDecoration: 'underline' }}>Clients</Link>{' '}
        to assign specific ad accounts or properties to each client.
      </div>
    </div>
  )
}

// ─── Helper components ────────────────────────────────────────────────────────

function ConnectorStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'badge-green', error: 'badge-red', disconnected: 'badge-gray', pending: 'badge-amber'
  }
  const labels: Record<string, string> = {
    active: 'Active', error: 'Error', disconnected: 'Disconnected', pending: 'Pending'
  }
  return <span className={`badge ${map[status] ?? 'badge-gray'}`}>{labels[status] ?? status}</span>
}

function GoogleGroupBadge({ status, count, total }: { status: 'none' | 'partial' | 'full'; count: number; total: number }) {
  if (status === 'none')    return <span className="badge badge-gray">Not connected</span>
  if (status === 'full')    return <span className="badge badge-green">Active — {total}/{total}</span>
  return <span className="badge badge-amber">Partial — {count}/{total}</span>
}

function GoogleSubLogo({ type, size }: { type: ConnectorType; size: number }) {
  if (type === 'google_ads')              return <GoogleAdsLogo size={size} />
  if (type === 'google_analytics')        return <GALogo size={size} />
  if (type === 'google_search_console')   return <GSCLogo size={size} />
  if (type === 'google_business_profile') return <GALogo size={size} />  // placeholder until GBP logo added
  return null
}
