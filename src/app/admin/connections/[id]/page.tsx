// Connector Settings — /admin/connections/[id]
// View and edit an existing agency-level connector.

import { createAdminClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Connector } from '@/lib/types'
import { getConnectorDef } from '@/lib/connectors/registry'
import EditConnectorForm from './EditConnectorForm'

export const dynamic = 'force-dynamic'

export default async function ConnectorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const db = createAdminClient()

  const { data } = await db.from('connectors').select('*').eq('id', id).single()
  const connector = data as Connector | null
  if (!connector) notFound()

  const def = getConnectorDef(connector.type)

  // Connected client accounts
  const { data: connections } = await db
    .from('client_connections')
    .select('id, external_id, external_name, status, last_synced_at, client:clients(name)')
    .eq('connector_id', id)
    .order('created_at')

  return (
    <div className="max-w-2xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6 text-sm">
        <Link href="/admin/connections" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
          Data Connections
        </Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{def.label}</span>
      </div>

      <div className="space-y-5">

        {/* Edit form */}
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-5">
            <div
              className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
              style={{ background: def.color }}
            >
              {def.icon}
            </div>
            <div>
              <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                {def.label}
              </h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`badge ${
                  connector.status === 'active' ? 'badge-green' :
                  connector.status === 'error'  ? 'badge-red'   : 'badge-gray'
                }`}>
                  {connector.status}
                </span>
                {connector.last_checked_at && (
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    Last checked {new Date(connector.last_checked_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          </div>

          <EditConnectorForm connector={connector} />
        </div>

        {/* Connected client accounts */}
        {connections && connections.length > 0 && (
          <div className="card p-5">
            <h2 className="section-title mb-3">Client Accounts Using This Connector</h2>
            <div className="space-y-2">
              {(connections as unknown as Array<{
                id: string
                external_id: string
                external_name: string | null
                status: string
                last_synced_at: string | null
                client: { name: string }[] | null
              }>).map(conn => (
                <div key={conn.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {conn.client?.[0]?.name ?? 'Unknown client'}
                    </span>
                    <span className="ml-2 text-xs" style={{ color: 'var(--text-faint)' }}>
                      {conn.external_name ?? conn.external_id}
                    </span>
                  </div>
                  <span className={`badge ${conn.status === 'active' ? 'badge-green' : 'badge-gray'}`}>
                    {conn.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
