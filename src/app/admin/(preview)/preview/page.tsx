// Admin — Preview Dashboards: client selection

import { createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'
import type { Client } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function PreviewIndexPage() {
  const db = createAdminClient()
  const { data } = await db.from('clients').select('id,name,logo_url,email').order('name')
  const clients = (data ?? []) as Pick<Client, 'id' | 'name' | 'logo_url' | 'email'>[]

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="page-header">
        <div>
          <h1 className="page-title">Preview Dashboards</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Select a client to preview their dashboard as they see it
          </p>
        </div>
      </div>

      {clients.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No clients yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map(client => (
            <Link
              key={client.id}
              href={`/admin/preview/${client.id}`}
              className="card p-5 flex items-center gap-4 group"
              style={{ textDecoration: 'none', border: '1px solid var(--border)', transition: 'border-color 0.15s' }}
            >
              {client.logo_url ? (
                <img src={client.logo_url} alt={client.name} className="h-10 w-10 object-contain rounded" style={{ flexShrink: 0 }} />
              ) : (
                <div
                  className="h-10 w-10 rounded-lg flex items-center justify-center text-white text-sm font-bold"
                  style={{ background: 'var(--blue)', flexShrink: 0 }}
                >
                  {client.name.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate" style={{ color: 'var(--text-primary)' }}>{client.name}</p>
                {client.email && <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-faint)' }}>{client.email}</p>}
              </div>
              <span className="ml-auto text-lg" style={{ color: 'var(--text-faint)', flexShrink: 0 }}>→</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
