import { createAdminClient } from '@/lib/supabase/server'
import type { Client, AdAccount } from '@/lib/types'
import Link from 'next/link'
import CopyButton from '@/components/CopyButton'

export default async function AdminPage() {
  const db = createAdminClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

  const { data: clients } = await db
    .from('clients')
    .select('*, ad_accounts(*)')
    .order('created_at', { ascending: false }) as {
    data: (Client & { ad_accounts: AdAccount[] })[] | null
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-gray-900">Clients ({clients?.length ?? 0})</h1>
        <Link
          href="/admin/clients/new"
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          + Add Client
        </Link>
      </div>

      <div className="space-y-3">
        {(clients || []).map(client => {
          const dashUrl = `${appUrl}/api/auth/access?token=${client.dashboard_token}`
          const google = client.ad_accounts?.filter(a => a.platform === 'google') ?? []
          const meta = client.ad_accounts?.filter(a => a.platform === 'meta') ?? []
          return (
            <div key={client.id} className="bg-white border border-gray-200 rounded-xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className="font-semibold text-gray-900">{client.name}</h2>
                    {google.length > 0 && (
                      <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">Google ✓</span>
                    )}
                    {meta.length > 0 && (
                      <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-medium">Meta ✓</span>
                    )}
                    {google.length === 0 && meta.length === 0 && (
                      <span className="text-xs bg-yellow-50 text-yellow-700 px-2 py-0.5 rounded-full">No accounts linked</span>
                    )}
                  </div>
                  {/* Dashboard link — copy this into GHL */}
                  <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                    <span className="text-xs text-gray-500 font-mono truncate flex-1">{dashUrl}</span>
                    <CopyButton text={dashUrl} />
                  </div>
                </div>
                <Link
                  href={`/admin/clients/${client.id}`}
                  className="text-sm border border-gray-200 px-3 py-1.5 rounded-lg hover:border-gray-300 text-gray-700 whitespace-nowrap flex-shrink-0"
                >
                  Manage →
                </Link>
              </div>
            </div>
          )
        })}
        {(!clients || clients.length === 0) && (
          <div className="text-center py-20 text-gray-400">
            <p className="text-sm">No clients yet.</p>
          </div>
        )}
      </div>
    </div>
  )
}
