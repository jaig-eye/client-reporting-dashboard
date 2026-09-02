// Client Connection Settings — /admin/clients/[id]/connections/[connectionId]
// View/edit a specific client_connection: rename, change status, or disconnect.

import { createAdminClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Client, ClientConnection, Connector } from '@/lib/types'
import { getConnectorDef } from '@/lib/connectors/registry'
import ConnectionSettingsForm from './ConnectionSettingsForm'

export const dynamic = 'force-dynamic'

export default async function ConnectionSettingsPage({
  params,
}: {
  params: Promise<{ id: string; connectionId: string }>
}) {
  const { id, connectionId } = await params
  const db = createAdminClient()

  const [clientRes, connectionRes] = await Promise.all([
    db.from('clients').select('id, name').eq('id', id).single(),
    db.from('client_connections')
      // Explicit columns, and the connector WITHOUT its auth. ConnectionSettingsForm is a
      // client component, so `select('*, connector:connectors(*)')` serialized every
      // per-client credential into the page HTML — 21 GoHighLevel API keys, WordPress
      // application passwords, BigCommerce access tokens. The form reads only
      // connector.type and config.page_filter_*, so none of it was ever needed.
      .select('id, client_id, connector_id, external_id, external_name, status, last_synced_at, sync_from, config, connector:connectors(id, type, label, status, config)')
      .eq('id', connectionId)
      .eq('client_id', id)
      .single(),
  ])

  const client     = clientRes.data as Client | null
  const connection = connectionRes.data as (ClientConnection & { connector: Connector }) | null

  if (!client || !connection) notFound()

  const def = getConnectorDef(connection.connector.type)

  return (
    <div className="max-w-lg">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6 text-sm flex-wrap">
        <Link href="/admin/clients" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
          Clients
        </Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <Link href={`/admin/clients/${id}`} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
          {client.name}
        </Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{def.label} Settings</span>
      </div>

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
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {connection.external_name ?? connection.external_id}
            </p>
          </div>
        </div>

        <ConnectionSettingsForm clientId={id} connection={connection} />
      </div>
    </div>
  )
}
