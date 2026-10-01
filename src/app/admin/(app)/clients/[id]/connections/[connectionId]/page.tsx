// Client Connection Settings — /admin/clients/[id]/connections/[connectionId]
// View/edit a specific client_connection: rename, change status, or disconnect.

import { createAdminClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import PageHeader from '@/components/ui/PageHeader'
import BrandLogo from '@/components/ui/BrandLogo'
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
    <div style={{ maxWidth: 620 }}>
      <PageHeader
        back={{ href: `/admin/clients/${id}?tab=sources`, label: client.name }}
        leading={<BrandLogo type={connection.connector.type} size={24} tile tileSize="xl" />}
        title={`${def.label} settings`}
        description={connection.external_name ?? connection.external_id}
      />
      <div className="card" style={{ padding: 20 }}>
        <ConnectionSettingsForm clientId={id} connection={connection} />
      </div>
    </div>
  )
}
