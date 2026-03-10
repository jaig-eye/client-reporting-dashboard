// New Client Connection — /admin/clients/[id]/connections/new?connector=[connectorId]
// Assigns a specific account from an agency connector to this client.
// Loads discovered accounts for easy selection via dropdown.

import { createAdminClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Client, Connector } from '@/lib/types'
import { getConnectorDef } from '@/lib/connectors/registry'
import NewConnectionForm from './NewConnectionForm'

export const dynamic = 'force-dynamic'

export default async function NewClientConnectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ connector?: string }>
}) {
  const { id } = await params
  const sp = await searchParams
  const connectorId = sp.connector

  if (!connectorId) notFound()

  const db = createAdminClient()

  const [clientRes, connectorRes, discoveredRes] = await Promise.all([
    db.from('clients').select('id, name').eq('id', id).single(),
    db.from('connectors').select('*').eq('id', connectorId).single(),
    db.from('connector_accounts')
      .select('external_id, external_name')
      .eq('connector_id', connectorId)
      .order('external_name'),
  ])

  const client    = clientRes.data as Client | null
  const connector = connectorRes.data as Connector | null

  if (!client || !connector) notFound()

  const def              = getConnectorDef(connector.type)
  const discoveredAccounts = discoveredRes.data ?? []

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
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Connect {def.label}</span>
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
              Connect {def.label} for {client.name}
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Assign an ad account or property to this client.
            </p>
          </div>
        </div>

        <NewConnectionForm
          clientId={id}
          connectorId={connectorId}
          connectorType={connector.type}
          discoveredAccounts={discoveredAccounts as { external_id: string; external_name: string | null }[]}
        />
      </div>
    </div>
  )
}
