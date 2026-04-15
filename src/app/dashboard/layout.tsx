// ─────────────────────────────────────────────────────────────────────────────
// Dashboard Layout
//
// Wraps all /dashboard/** pages with the persistent sidebar navigation.
// Reads the client session to determine which connector types are active.
// If an admin session is also present, renders AdminDashboardBar at the top.
// ─────────────────────────────────────────────────────────────────────────────

import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { getAgencySettings } from '@/lib/agency-settings'
import { isAdminAuthed } from '@/lib/auth'
import type { Client, Connector } from '@/lib/types'
import type { ConnectorType } from '@/lib/types'
import DashboardSidebar from '@/components/DashboardSidebar'
import DashboardNavigationRefresher from '@/components/DashboardNavigationRefresher'
import AdminDashboardBar from '@/components/admin/AdminDashboardBar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const db          = createAdminClient()

  const token        = cookieStore.get('client_token')?.value
  const adminSession = cookieStore.get('admin_session')?.value
  const isAdmin      = isAdminAuthed(adminSession)

  let client:  Client | null  = null
  let activeConnectorTypes: ConnectorType[] = []
  let settings: Awaited<ReturnType<typeof getAgencySettings>> | null = null

  if (token) {
    const [clientResult, agencySettings] = await Promise.all([
      db.from('clients').select('*').eq('dashboard_token', token).single(),
      getAgencySettings(),
    ])
    client   = clientResult.data as Client | null
    settings = agencySettings

    if (client) {
      const { data: connectionsData } = await db
        .from('client_connections')
        .select('connector:connectors(type)')
        .eq('client_id', client.id)
        .eq('status', 'active')

      activeConnectorTypes = (
        (connectionsData ?? []) as unknown as { connector: { type: ConnectorType } | null }[]
      )
        .map(c => c.connector?.type)
        .filter((v): v is ConnectorType => !!v)
        .filter((v, i, arr) => arr.indexOf(v) === i)
    }
  }

  // Load admin bar data when admin session is active
  let adminClients: { id: string; name: string; dashboard_token: string }[] = []
  if (isAdmin) {
    const { data } = await db
      .from('clients')
      .select('id, name, dashboard_token')
      .order('name')
    adminClients = (data ?? []) as typeof adminClients
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  return (
    <>
      <DashboardNavigationRefresher />

      {/* Admin overlay bar — only visible to admins */}
      {isAdmin && client && (
        <AdminDashboardBar
          currentClientId={client.id}
          currentClientName={client.name}
          dashboardToken={(client as unknown as Record<string, string>).dashboard_token ?? token ?? ''}
          clients={adminClients}
          appUrl={appUrl}
        />
      )}

      <div style={{
        display: 'flex',
        minHeight: '100vh',
        background: 'var(--bg-base)',
        paddingTop: isAdmin && client ? 40 : 0,
      }}>
        {client && (
          <Suspense fallback={<div style={{ width: 220, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--bg-surface)' }} />}>
            <DashboardSidebar
              activeConnectorTypes={activeConnectorTypes}
              agencyLogoUrl={settings?.agency_logo_url}
              agencyName={settings?.agency_name}
              clientLogoUrl={client.logo_url}
              clientName={client.name}
            />
          </Suspense>
        )}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </div>
    </>
  )
}
