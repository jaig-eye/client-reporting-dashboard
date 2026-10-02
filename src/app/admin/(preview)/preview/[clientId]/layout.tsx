// Admin preview, per client: a bar (in the admin's theme) with the client switcher, the dashboard below.

import { redirect }                from 'next/navigation'
import Link                        from 'next/link'
import { CaretRight }              from '@phosphor-icons/react/dist/ssr'
import { createAdminClient }       from '@/lib/supabase/server'
import type { Client }             from '@/lib/types'
import PreviewClientSwitcher       from '@/components/admin/PreviewClientSwitcher'

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

  const client     = clientRes.data as Pick<Client, 'id' | 'name' | 'logo_url'> | null
  if (!client) redirect('/admin/preview')

  const allClients = (allClientsRes.data ?? []) as Pick<Client, 'id' | 'name' | 'logo_url'>[]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <div className="pv-bar">
        <div className="pv-bar-left">
          <span className="pv-label">Previewing</span>
          <PreviewClientSwitcher
            currentClient={{ id: client.id, name: client.name, logo_url: client.logo_url ?? null }}
            clients={allClients.map(c => ({ id: c.id, name: c.name, logo_url: c.logo_url ?? null }))}
          />
        </div>
        <Link href={`/admin/clients/${clientId}`} className="pv-link">
          Client settings<CaretRight size={12} weight="bold" aria-hidden />
        </Link>
      </div>

      {/* Full-height iframe area */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  )
}
