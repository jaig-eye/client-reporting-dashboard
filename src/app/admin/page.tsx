import { createAdminClient } from '@/lib/supabase/server'
import type { Client, AdAccount } from '@/lib/types'
import Link from 'next/link'
import CopyButton from '@/components/CopyButton'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const db = createAdminClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

  const [clientsResult, accountsResult] = await Promise.all([
    db.from('clients').select('*').order('created_at', { ascending: false }),
    db.from('ad_accounts').select('id, client_id, platform').not('client_id', 'is', null),
  ])

  const clients    = (clientsResult.data ?? []) as Client[]
  const allMapped  = (accountsResult.data ?? []) as AdAccount[]

  const byClient = new Map<string, AdAccount[]>()
  for (const a of allMapped) {
    if (!byClient.has(a.client_id!)) byClient.set(a.client_id!, [])
    byClient.get(a.client_id!)!.push(a)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-white">Clients ({clients.length})</h1>
        <Link
          href="/admin/clients/new"
          className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + Add Client
        </Link>
      </div>

      <div className="space-y-3">
        {clients.map(client => {
          const dashUrl      = `${appUrl}/api/auth/access?token=${client.dashboard_token}`
          const accts        = byClient.get(client.id) ?? []
          const google       = accts.filter(a => a.platform === 'google')
          const meta         = accts.filter(a => a.platform === 'meta')
          return (
            <div key={client.id} className="rounded-2xl p-5 border" style={{ background: 'rgba(255,255,255,0.025)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderColor: 'rgba(255,255,255,0.07)' }}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className="font-semibold text-white">{client.name}</h2>
                    {google.length > 0 && (
                      <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full font-medium">Google ✓</span>
                    )}
                    {meta.length > 0 && (
                      <span className="text-xs bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded-full font-medium">Meta ✓</span>
                    )}
                    {google.length === 0 && meta.length === 0 && (
                      <span className="text-xs bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full">No accounts linked</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <span className="text-xs text-slate-500 font-mono truncate flex-1">{dashUrl}</span>
                    <CopyButton text={dashUrl} />
                  </div>
                </div>
                <Link
                  href={`/admin/clients/${client.id}`}
                  className="text-sm text-slate-400 px-3 py-1.5 rounded-lg hover:text-slate-200 transition-colors whitespace-nowrap flex-shrink-0" style={{ border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  Manage →
                </Link>
              </div>
            </div>
          )
        })}
        {clients.length === 0 && (
          <div className="text-center py-20 text-slate-600">
            <p className="text-sm">No clients yet.</p>
          </div>
        )}
      </div>
    </div>
  )
}
