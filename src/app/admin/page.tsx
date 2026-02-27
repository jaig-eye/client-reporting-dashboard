import { createAdminClient } from '@/lib/supabase/server'
import type { Client, AdAccount, SyncLog } from '@/lib/types'
import Link from 'next/link'

export default async function AdminPage() {
  const db = createAdminClient()

  const { data: clients } = await db
    .from('clients')
    .select('*, ad_accounts(*)')
    .order('created_at', { ascending: false }) as { data: (Client & { ad_accounts: AdAccount[] })[] | null }

  // Get last sync for each client
  const { data: syncLogs } = await db
    .from('sync_logs')
    .select('*')
    .in('client_id', (clients || []).map(c => c.id))
    .order('started_at', { ascending: false })
    .limit(50) as { data: (SyncLog & { client_id: string })[] | null }

  const lastSync = (clientId: string) =>
    syncLogs?.find(l => l.client_id === clientId)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Clients ({clients?.length || 0})</h2>
        <Link
          href="/admin/clients/new"
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + New Client
        </Link>
      </div>

      <div className="space-y-3">
        {(clients || []).map(client => {
          const sync = lastSync(client.id)
          return (
            <div key={client.id} className="bg-white border border-gray-200 rounded-xl p-5 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="font-semibold text-gray-900">{client.name}</h3>
                  <span className="text-xs text-gray-400">{client.email}</span>
                </div>
                <div className="flex items-center gap-3">
                  {(client.ad_accounts || []).map(acc => (
                    <span key={acc.id} className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      acc.platform === 'google' ? 'bg-blue-50 text-blue-700' : 'bg-indigo-50 text-indigo-700'
                    }`}>
                      {acc.platform === 'google' ? 'Google Ads' : 'Meta'}: {acc.account_name || acc.account_id}
                    </span>
                  ))}
                  {(client.ad_accounts || []).length === 0 && (
                    <span className="text-xs text-gray-400">No ad accounts linked</span>
                  )}
                </div>
                {sync && (
                  <p className="text-xs text-gray-400 mt-1">
                    Last sync: {new Date(sync.started_at).toLocaleString()} —
                    <span className={sync.status === 'success' ? 'text-green-600' : sync.status === 'error' ? 'text-red-500' : 'text-yellow-500'}>
                      {' '}{sync.status}
                    </span>
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <SyncButton clientId={client.id} />
                <Link
                  href={`/admin/clients/${client.id}`}
                  className="text-sm border border-gray-200 px-3 py-1.5 rounded-lg hover:border-gray-300 text-gray-700"
                >
                  Manage
                </Link>
              </div>
            </div>
          )
        })}

        {(!clients || clients.length === 0) && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-sm">No clients yet. Add your first client to get started.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function SyncButton({ clientId }: { clientId: string }) {
  return (
    <form action="/api/sync/trigger" method="POST">
      <input type="hidden" name="clientId" value={clientId} />
      <button
        type="submit"
        className="text-sm border border-gray-200 px-3 py-1.5 rounded-lg hover:border-gray-300 text-gray-700"
      >
        Sync
      </button>
    </form>
  )
}
