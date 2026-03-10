// Client Detail — /admin/clients/[id]
// Full-width client management page with source-specific connection cards.
// Each data source shows: connection status, account name, last sync, and actions.
// No more single "Map Ad Accounts" form — each source has its own card.

import { createAdminClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Client, ClientConnection, Connector, SyncJob } from '@/lib/types'
import { ALL_CONNECTOR_TYPES, getConnectorDef, isConnectorImplemented } from '@/lib/connectors/registry'
import CopyButton from '@/components/CopyButton'
import ClientSyncButton from './ClientSyncButton'
import DeleteClientButton from './DeleteClientButton'
import ClientLogoUpload from './ClientLogoUpload'

export const dynamic = 'force-dynamic'

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ connected?: string; synced?: string; error?: string }>
}) {
  const { id } = await params
  const sp = await searchParams
  const db = createAdminClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

  const [clientRes, connectionsRes, connectorsRes, recentJobsRes] = await Promise.all([
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
  ])

  const client = clientRes.data as Client | null
  if (!client) notFound()

  const connections = (connectionsRes.data ?? []) as (ClientConnection & { connector: Connector })[]
  const connectors  = (connectorsRes.data ?? []) as Connector[]
  const recentJobs  = (recentJobsRes.data ?? []) as SyncJob[]

  // Index connections by connector type for quick lookup
  const connByType = new Map(connections.map(c => [c.connector.type, c]))
  const dashUrl    = `${appUrl}/api/auth/access?token=${client.dashboard_token}`

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6 text-sm">
        <Link href="/admin/clients" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
          Clients
        </Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{client.name}</span>
      </div>

      {/* Flash notices */}
      {sp.connected && (
        <Notice type="success">{sp.connected.replace(/_/g, ' ')} connected successfully.</Notice>
      )}
      {sp.synced && <Notice type="success">Sync complete.</Notice>}
      {sp.error  && <Notice type="error">Error: {sp.error.replace(/_/g, ' ')}</Notice>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Left: client info + dashboard link + recent jobs ── */}
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="section-title mb-3">Client Info</h2>
            <div className="space-y-3 text-sm">
              <InfoField label="Name"  value={client.name}  />
              <InfoField label="Email" value={client.email} />
              {client.slug && <InfoField label="Slug" value={client.slug} mono />}
            </div>
          </div>

          <div className="card p-5">
            <h2 className="section-title mb-3">Client Logo</h2>
            <p className="section-desc mb-3">Displayed on the client&apos;s reporting dashboard.</p>
            <ClientLogoUpload clientId={id} currentLogoUrl={client.logo_url} />
          </div>

          {/* Danger zone */}
          <div className="card p-5">
            <h2 className="section-title mb-3">Danger Zone</h2>
            <DeleteClientButton clientId={id} clientName={client.name} />
          </div>

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

          {recentJobs.length > 0 && (
            <div className="card p-5">
              <h2 className="section-title mb-3">Recent Syncs</h2>
              <div className="space-y-2">
                {recentJobs.slice(0, 5).map(job => (
                  <div key={job.id} className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {new Date(job.started_at).toLocaleString('en-US', {
                        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                      })}
                    </span>
                    <span className={`badge ${
                      job.status === 'success' ? 'badge-green' :
                      job.status === 'error'   ? 'badge-red'   : 'badge-amber'
                    }`}>
                      {job.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Right: source-specific connection cards ── */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="section-title">Data Sources</h2>

          {ALL_CONNECTOR_TYPES.map(type => {
            const def         = getConnectorDef(type)
            const connection  = connByType.get(type)
            const connector   = connectors.find(c => c.type === type)
            const implemented = isConnectorImplemented(type)

            // Determine the card state
            const state =
              !implemented ? 'coming-soon'
              : !connector ? 'connector-missing'
              : connection ? 'connected'
              : 'not-connected'

            return (
              <div key={type} className="card p-5">
                <div className="flex items-start justify-between gap-4">
                  {/* Icon + description */}
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div
                      className="h-9 w-9 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                      style={{ background: state === 'coming-soon' ? '#d1d5db' : def.color }}
                    >
                      {def.icon}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {def.label}
                        </h3>
                        <SourceBadge state={state} />
                      </div>

                      {state === 'connected' && connection && (
                        <div className="text-xs space-y-0.5" style={{ color: 'var(--text-muted)' }}>
                          <p>{connection.external_name ?? connection.external_id}</p>
                          {connection.last_synced_at && (
                            <p>Last synced {new Date(connection.last_synced_at).toLocaleString('en-US', {
                              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                            })}</p>
                          )}
                        </div>
                      )}

                      {state === 'connector-missing' && (
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          <Link href="/admin/connections" style={{ color: 'var(--blue)' }}>
                            Set up agency {def.label} connection first →
                          </Link>
                        </p>
                      )}

                      {state === 'not-connected' && (
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          Agency connector is ready — assign an account to this client.
                        </p>
                      )}

                      {state === 'coming-soon' && (
                        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                          {def.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {state === 'connected' && connection && (
                      <>
                        <ClientSyncButton clientId={id} connectionId={connection.id} />
                        <Link
                          href={`/admin/clients/${id}/connections/${connection.id}`}
                          className="btn btn-secondary"
                          style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
                        >
                          Settings
                        </Link>
                      </>
                    )}
                    {state === 'not-connected' && connector && (
                      <Link
                        href={`/admin/clients/${id}/connections/new?connector=${connector.id}`}
                        className="btn btn-primary"
                        style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
                      >
                        Connect Account
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function InfoField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p
        className={mono ? 'font-mono text-xs' : 'text-sm'}
        style={{ color: 'var(--text-secondary)' }}
      >
        {value}
      </p>
    </div>
  )
}

function SourceBadge({ state }: { state: string }) {
  const m: Record<string, { label: string; cls: string }> = {
    connected:           { label: 'Connected',   cls: 'badge-green' },
    'connector-missing': { label: 'Not set up',  cls: 'badge-amber' },
    'not-connected':     { label: 'Available',   cls: 'badge-gray'  },
    'coming-soon':       { label: 'Coming soon', cls: 'badge-gray'  },
  }
  const d = m[state] ?? { label: state, cls: 'badge-gray' }
  return <span className={`badge ${d.cls}`}>{d.label}</span>
}

function Notice({ type, children }: { type: 'success' | 'error'; children: React.ReactNode }) {
  const s = type === 'success'
    ? { bg: 'var(--green-subtle)', border: '#bbf7d0', color: 'var(--green)' }
    : { bg: 'var(--red-subtle)',   border: '#fecaca', color: 'var(--red)'   }
  return (
    <div
      className="mb-4 rounded-xl px-4 py-3 text-sm"
      style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.color }}
    >
      {children}
    </div>
  )
}
