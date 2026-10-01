// Connection settings — /admin/connections/[id]
// One agency-level connection: its status, its settings, how to reconnect, and the client accounts
// that use it.

import { createAdminClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Connector } from '@/lib/types'
import { getConnectorDef } from '@/lib/connectors/registry'
import PageHeader from '@/components/ui/PageHeader'
import Section from '@/components/ui/Section'
import BrandLogo from '@/components/ui/BrandLogo'
import StatusBadge from '@/components/ui/StatusBadge'
import { connectorStatus } from '@/components/admin/integrations/IntegrationRow'
import EditConnectorForm from './EditConnectorForm'

export const dynamic = 'force-dynamic'

export default async function ConnectorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ connected?: string }>
}) {
  const { id } = await params
  const sp = await searchParams
  const db = createAdminClient()

  // Explicit column list, NOT select('*'). EditConnectorForm is a client component, so every
  // column handed to it is serialized into the page HTML — and `auth` holds the live credentials.
  // The form never shows a stored secret, so it doesn't need them.
  const [{ data }, { data: tokenRow }] = await Promise.all([
    db.from('connectors')
      .select('id, type, label, status, config, last_checked_at, created_at, updated_at')
      .eq('id', id)
      .single(),
    // Whether a Google Ads developer token is stored — read here and kept on the server. The old
    // check read connector.auth, which the select above leaves out, so the warning always showed.
    db.from('connectors').select('dev_token:auth->>developer_token').eq('id', id).maybeSingle(),
  ])
  const connector = data as Connector | null
  if (!connector) notFound()
  const hasDevToken = !!(tokenRow as { dev_token?: string | null } | null)?.dev_token

  const def = getConnectorDef(connector.type)
  const status = connectorStatus(connector.status)

  const { data: connections } = await db
    .from('client_connections')
    .select('id, client_id, external_id, external_name, status, last_synced_at, client:clients(name)')
    .eq('connector_id', id)
    .order('created_at')
  type ConnRow = { id: string; client_id: string; external_id: string; external_name: string | null; status: string; last_synced_at: string | null; client: { name: string } | { name: string }[] | null }
  const rows = (connections ?? []) as unknown as ConnRow[]
  const clientName = (c: ConnRow['client']) => (Array.isArray(c) ? c[0]?.name : c?.name) ?? 'Unknown client'

  return (
    <div style={{ maxWidth: 820 }}>
      <PageHeader
        back={{ href: '/admin/connections', label: 'Integrations' }}
        leading={<BrandLogo type={connector.type} size={24} tile tileSize="xl" />}
        title={def.label}
        description={connector.last_checked_at ? `Last checked ${new Date(connector.last_checked_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : def.description}
        actions={<StatusBadge tone={status.tone} title={status.title}>{status.label}</StatusBadge>}
      />

      {sp.connected && <div className="ui-notice ui-notice--success" role="status">Connected. Account discovery runs in the background, so new accounts can take a minute to appear.</div>}
      {connector.type === 'google_ads' && !hasDevToken && (
        <div className="ui-notice ui-notice--warning" role="status">
          No developer token is saved, so Google Ads won’t sync or find accounts. Paste it below and save.
        </div>
      )}

      <div className="ui-stack">
        <Section title="Settings" description="The label and options for this connection. Credentials are never shown once saved; type a new one to replace it.">
          <EditConnectorForm connector={connector} />
        </Section>

        {rows.length > 0 && (
          <Section title="Clients using this connection" description="The accounts assigned to each client." flush>
            <div>
              {rows.map(conn => (
                <div key={conn.id} className="ui-row">
                  <span className="ui-row-text">
                    <Link href={`/admin/clients/${conn.client_id}?tab=sources`} className="ui-row-title" style={{ textDecoration: 'none' }}>{clientName(conn.client)}</Link>
                    <span className="ui-row-sub">
                      {conn.external_name ?? conn.external_id}
                      {conn.last_synced_at && `, synced ${new Date(conn.last_synced_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                    </span>
                  </span>
                  <StatusBadge tone={conn.status === 'active' ? 'success' : 'neutral'}>{conn.status === 'active' ? 'Active' : conn.status.charAt(0).toUpperCase() + conn.status.slice(1)}</StatusBadge>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}
