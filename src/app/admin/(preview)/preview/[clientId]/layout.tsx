// Admin Preview — per-client layout: sticky dark bar with client switcher

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import type { Client } from '@/lib/types'
import PreviewClientSwitcher from '@/components/admin/PreviewClientSwitcher'

export default async function PreviewClientLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ clientId: string }>
}) {
  const { clientId } = await params
  const db = createAdminClient()

  const [clientRes, allClientsRes] = await Promise.all([
    db.from('clients').select('id,name,logo_url').eq('id', clientId).single(),
    db.from('clients').select('id,name,logo_url').order('name'),
  ])

  const client = clientRes.data as Pick<Client, 'id' | 'name' | 'logo_url'> | null
  if (!client) redirect('/admin/preview')

  const allClients = (allClientsRes.data ?? []) as Pick<Client, 'id' | 'name' | 'logo_url'>[]

  return (
    <div>
      {/* Sticky dark admin bar */}
      <div
        style={{
          position: 'sticky', top: 0, zIndex: 20,
          background: '#0f172a', borderBottom: '1px solid #1e293b',
          padding: '0 1.25rem', height: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
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
      {children}
    </div>
  )
}
