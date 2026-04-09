// Admin Preview — per-client layout: sticky dark bar with client switcher + dashboard sidebar

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { getAgencySettings } from '@/lib/agency-settings'
import type { Client, Connector } from '@/lib/types'
import type { ConnectorType } from '@/lib/types'
import PreviewClientSwitcher from '@/components/admin/PreviewClientSwitcher'
import DashboardNavigationRefresher from '@/components/DashboardNavigationRefresher'
import DashboardSidebar from '@/components/DashboardSidebar'

export default async function PreviewClientLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ clientId: string }>
}) {
  const { clientId } = await params
  const db = createAdminClient()

  const [clientRes, allClientsRes, settings] = await Promise.all([
    db.from('clients').select('id,name,logo_url').eq('id', clientId).single(),
    db.from('clients').select('id,name,logo_url').order('name'),
    getAgencySettings(),
  ])

  const client = clientRes.data as Pick<Client, 'id' | 'name' | 'logo_url'> | null
  if (!client) redirect('/admin/preview')

  const allClients = (allClientsRes.data ?? []) as Pick<Client, 'id' | 'name' | 'logo_url'>[]

  // Fetch active connector types for this client (to populate sidebar active states)
  const { data: connectionsData } = await db
    .from('client_connections')
    .select('connector:connectors(type)')
    .eq('client_id', clientId)
    .eq('status', 'active')

  const activeConnectorTypes: ConnectorType[] = (
    (connectionsData ?? []) as unknown as { connector: { type: ConnectorType } | null }[]
  )
    .map(c => c.connector?.type)
    .filter((v): v is ConnectorType => !!v)
    .filter((v, i, arr) => arr.indexOf(v) === i)

  // Build a preview-aware base URL prefix so sidebar links go to preview routes
  const previewBase = `/admin/preview/${clientId}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Sticky dark admin bar */}
      <div
        style={{
          position: 'sticky', top: 0, zIndex: 30,
          background: '#0f172a', borderBottom: '1px solid #1e293b',
          padding: '0 1.25rem', height: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: '#475569', fontWeight: 700, fontSize: '0.65rem', letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
            Admin Preview
          </span>
          <span style={{ color: '#1e293b', fontSize: '1rem' }}>|</span>
          <PreviewClientSwitcher
            currentClient={{ id: client.id, name: client.name, logo_url: client.logo_url ?? null }}
            clients={allClients.map(c => ({ id: c.id, name: c.name, logo_url: c.logo_url ?? null }))}
          />
        </div>
        <Link
          href={`/admin/clients/${clientId}`}
          style={{ color: '#60a5fa', textDecoration: 'none', fontSize: '0.72rem', fontWeight: 500, whiteSpace: 'nowrap' }}
        >
          Admin Settings →
        </Link>
      </div>

      {/* Two-column: client dashboard sidebar + content */}
      <div style={{ display: 'flex', flex: 1 }}>
        <Suspense fallback={<div style={{ width: 220, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--bg-surface)' }} />}>
          <DashboardSidebar
            activeConnectorTypes={activeConnectorTypes}
            agencyLogoUrl={settings.agency_logo_url}
            agencyName={settings.agency_name}
            clientLogoUrl={client.logo_url}
            clientName={client.name}
            basePath={previewBase}
            isAdminPreview
          />
        </Suspense>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <DashboardNavigationRefresher />
          {children}
        </div>
      </div>
    </div>
  )
}
