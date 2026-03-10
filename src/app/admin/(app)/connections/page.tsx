// Data Connections — /admin/connections
// Agency-level management of all data source connectors.
// Each connector type can be connected once at the agency level,
// then assigned to specific clients in the Clients section.

import { createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { ALL_CONNECTOR_TYPES, getConnectorDef, isConnectorImplemented } from '@/lib/connectors/registry'
import type { Connector } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function ConnectionsPage() {
  const db = createAdminClient()
  const { data: connectors } = await db.from('connectors').select('*').order('created_at')
  const existing = (connectors ?? []) as Connector[]

  // Map type → existing connector for quick lookup
  const byType = new Map(existing.map(c => [c.type, c]))

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Data Connections</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Connect the agency to external data sources. Once connected, assign accounts to clients.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {ALL_CONNECTOR_TYPES.map(type => {
          const def        = getConnectorDef(type)
          const connector  = byType.get(type)
          const implemented = isConnectorImplemented(type)
          const status     = connector?.status ?? 'disconnected'

          return (
            <div key={type} className="card p-5">
              <div className="flex items-start justify-between gap-4">
                {/* Icon + description */}
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

                {/* Action */}
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

function ConnectorStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'badge-green', error: 'badge-red', disconnected: 'badge-gray', pending: 'badge-amber'
  }
  const labels: Record<string, string> = {
    active: 'Active', error: 'Error', disconnected: 'Disconnected', pending: 'Pending'
  }
  return <span className={`badge ${map[status] ?? 'badge-gray'}`}>{labels[status] ?? status}</span>
}
