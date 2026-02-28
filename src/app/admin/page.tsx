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
        <h1 className="text-lg font-semibold text-white">Clients ({clients?.length ?? 0})</h1>
        <Link
          href="/admin/clients/new"
          className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
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
            <div key={client.id} className="bg-[#0f1525] border border-[#1e2a40] rounded-xl p-5">
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
                  <div className="flex items-center gap-2 bg-[#080c18] border border-[#1e2a40] rounded-lg px-3 py-2">
                    <span className="text-xs text-slate-500 font-mono truncate flex-1">{dashUrl}</span>
                    <CopyButton text={dashUrl} />
                  </div>
                </div>
                <Link
                  href={`/admin/clients/${client.id}`}
                  className="text-sm border border-[#1e2a40] text-slate-400 px-3 py-1.5 rounded-lg hover:border-[#2a3a54] hover:text-slate-200 transition-colors whitespace-nowrap flex-shrink-0"
                >
                  Manage →
                </Link>
              </div>
            </div>
          )
        })}
        {(!clients || clients.length === 0) && (
          <div className="text-center py-20 text-slate-600">
            <p className="text-sm">No clients yet.</p>
          </div>
        )}
      </div>
    </div>
  )
}
