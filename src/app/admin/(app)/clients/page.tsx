// Clients List — /admin/clients
// Full-width table of all clients with their connection status per data source.
// Source-aware: shows which connectors are connected, last synced, etc.

import { createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'
import type { Client, ClientConnection, Connector } from '@/lib/types'
import { getConnectorDef } from '@/lib/connectors/registry'
import CopyButton from '@/components/CopyButton'
import PreviewButton from '@/components/admin/PreviewButton'

export const dynamic = 'force-dynamic'

export default async function ClientsPage() {
  const db = createAdminClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

  const [clientsRes, connectionsRes] = await Promise.all([
    db.from('clients').select('*').order('created_at', { ascending: false }),
    db.from('client_connections').select('*, connector:connectors(id, type, label, status)').eq('status', 'active'),
  ])

  const clients     = (clientsRes.data     ?? []) as Client[]
  const connections = (connectionsRes.data ?? []) as (ClientConnection & { connector: Connector })[]

  // Group connections by client_id for quick lookup
  const connsByClient = new Map<string, (ClientConnection & { connector: Connector })[]>()
  for (const conn of connections) {
    if (!connsByClient.has(conn.client_id)) connsByClient.set(conn.client_id, [])
    connsByClient.get(conn.client_id)!.push(conn)
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Clients</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {clients.length} client{clients.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link href="/admin/clients/new" className="btn btn-primary">
          + Add Client
        </Link>
      </div>

      {clients.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No clients yet</p>
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            Add your first client to start managing their data connections.
          </p>
          <Link href="/admin/clients/new" className="btn btn-primary">
            + Add Client
          </Link>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ whiteSpace: 'nowrap' }}>Client</th>
                <th style={{ whiteSpace: 'nowrap' }}>Data Sources</th>
                <th style={{ whiteSpace: 'nowrap' }}>Dashboard URL</th>
                <th style={{ whiteSpace: 'nowrap' }}>Last Sync</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {clients.map(client => {
                const conns   = connsByClient.get(client.id) ?? []
                const dashUrl = `${appUrl}/api/auth/access?token=${client.dashboard_token}`
                const lastSync = conns
                  .filter(c => c.last_synced_at)
                  .sort((a, b) => new Date(b.last_synced_at!).getTime() - new Date(a.last_synced_at!).getTime())[0]
                  ?.last_synced_at

                return (
                  <tr key={client.id}>
                    <td>
                      <div className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                        {client.name}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
                        {client.email}
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {conns.length === 0 ? (
                          <span className="badge badge-gray">No sources</span>
                        ) : (
                          conns.map(conn => {
                            const def = getConnectorDef(conn.connector.type)
                            return (
                              <span
                                key={conn.id}
                                className="badge badge-blue"
                                title={conn.external_name ?? conn.external_id}
                              >
                                {def.label}
                              </span>
                            )
                          })
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-2 max-w-xs">
                        <span
                          className="text-xs font-mono truncate"
                          style={{ color: 'var(--text-faint)', maxWidth: '200px' }}
                        >
                          {dashUrl}
                        </span>
                        <CopyButton text={dashUrl} />
                      </div>
                    </td>
                    <td>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {lastSync
                          ? new Date(lastSync).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                          : '—'}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <PreviewButton clientId={client.id} />
                        <Link
                          href={`/admin/clients/${client.id}`}
                          className="btn btn-secondary"
                          style={{ padding: '0.375rem 0.75rem' }}
                        >
                          Manage →
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
