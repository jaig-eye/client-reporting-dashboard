import { createAdminClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { Client, AdAccount, SyncLog } from '@/lib/types'
import Link from 'next/link'

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ connected?: string; synced?: string; error?: string }>
}) {
  const { id } = await params
  const sp = await searchParams
  const db = createAdminClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

  const { data: client } = await db
    .from('clients')
    .select('*, ad_accounts(*)')
    .eq('id', id)
    .single() as { data: (Client & { ad_accounts: AdAccount[] }) | null }

  if (!client) notFound()

  const { data: recentSyncs } = await db
    .from('sync_logs')
    .select('*')
    .eq('client_id', id)
    .order('started_at', { ascending: false })
    .limit(5) as { data: SyncLog[] | null }

  const dashUrl = `${appUrl}/api/auth/access?token=${client.dashboard_token}`
  const googleAccounts = client.ad_accounts?.filter(a => a.platform === 'google') ?? []
  const metaAccounts = client.ad_accounts?.filter(a => a.platform === 'meta') ?? []
  const isFullyConnected = googleAccounts.length > 0 || metaAccounts.length > 0

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-300 transition-colors">← Clients</Link>
        <span className="text-[#1e2a40]">/</span>
        <h1 className="text-lg font-semibold text-white">{client.name}</h1>
      </div>

      {sp.connected && (
        <div className="mb-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm px-4 py-3 rounded-xl">
          {sp.connected === 'google' ? 'Google Ads' : 'Meta'} connected successfully.
        </div>
      )}
      {sp.synced && (
        <div className="mb-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm px-4 py-3 rounded-xl">
          Sync complete.
        </div>
      )}
      {sp.error && (
        <div className="mb-4 bg-red-500/10 border border-red-500/20 text-red-400 text-sm px-4 py-3 rounded-xl">
          Error: {sp.error.replace(/_/g, ' ')}
        </div>
      )}

      <div className="bg-[#0f1525] border border-[#1e2a40] rounded-xl p-6 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
            isFullyConnected ? 'bg-emerald-500 text-white' : 'bg-blue-600 text-white'
          }`}>{isFullyConnected ? '✓' : '1'}</div>
          <h2 className="font-semibold text-slate-100">Connect Ad Accounts</h2>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-[#080c18] border border-[#1e2a40] rounded-lg">
            <div>
              <p className="text-sm font-medium text-slate-200">Google Ads</p>
              {googleAccounts.length > 0
                ? googleAccounts.map(a => (
                    <p key={a.id} className="text-xs text-emerald-400">{a.account_name || a.account_id}</p>
                  ))
                : <p className="text-xs text-slate-600">Not connected</p>
              }
            </div>
            <a
              href={`/api/auth/google?clientId=${client.id}`}
              className={`text-sm px-4 py-1.5 rounded-lg font-medium transition-colors ${
                googleAccounts.length > 0
                  ? 'border border-[#1e2a40] text-slate-400 hover:border-[#2a3a54] hover:text-slate-300'
                  : 'bg-blue-600 text-white hover:bg-blue-500'
              }`}
            >
              {googleAccounts.length > 0 ? 'Reconnect' : 'Connect'}
            </a>
          </div>

          <div className="flex items-center justify-between p-3 bg-[#080c18] border border-[#1e2a40] rounded-lg">
            <div>
              <p className="text-sm font-medium text-slate-200">Meta Ads</p>
              {metaAccounts.length > 0
                ? metaAccounts.map(a => (
                    <p key={a.id} className="text-xs text-emerald-400">{a.account_name || a.account_id}</p>
                  ))
                : <p className="text-xs text-slate-600">Not connected</p>
              }
            </div>
            <a
              href={`/api/auth/meta?clientId=${client.id}`}
              className={`text-sm px-4 py-1.5 rounded-lg font-medium transition-colors ${
                metaAccounts.length > 0
                  ? 'border border-[#1e2a40] text-slate-400 hover:border-[#2a3a54] hover:text-slate-300'
                  : 'bg-indigo-600 text-white hover:bg-indigo-500'
              }`}
            >
              {metaAccounts.length > 0 ? 'Reconnect' : 'Connect'}
            </a>
          </div>
        </div>
      </div>

      <div className="bg-[#0f1525] border border-[#1e2a40] rounded-xl p-6 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">2</div>
          <h2 className="font-semibold text-slate-100">Sync Data</h2>
        </div>
        <p className="text-sm text-slate-500 mb-4">Pull the last 90 days of campaign data from connected accounts.</p>
        <div className="flex items-center gap-3">
          <form action="/api/sync/trigger" method="POST">
            <input type="hidden" name="clientId" value={client.id} />
            <input type="hidden" name="days" value="90" />
            <button
              type="submit"
              disabled={!isFullyConnected}
              className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Sync Last 90 Days
            </button>
          </form>
          {recentSyncs && recentSyncs.length > 0 && (
            <span className="text-xs text-slate-600">
              Last: {new Date(recentSyncs[0].started_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              {' — '}
              <span className={recentSyncs[0].status === 'success' ? 'text-emerald-400' : 'text-red-400'}>
                {recentSyncs[0].status}
              </span>
              {recentSyncs[0].records_synced > 0 && ` (${recentSyncs[0].records_synced} rows)`}
            </span>
          )}
        </div>
      </div>

      <div className="bg-[#0f1525] border border-[#1e2a40] rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">3</div>
          <h2 className="font-semibold text-slate-100">Add to GHL Sidebar</h2>
        </div>
        <p className="text-sm text-slate-500 mb-3">
          Copy this link and paste it as a Custom Menu Link in the client&apos;s GHL sub-account.
        </p>
        <div className="flex items-center gap-2 bg-[#080c18] border border-[#1e2a40] rounded-lg px-3 py-3">
          <code className="text-xs text-slate-400 font-mono break-all flex-1">{dashUrl}</code>
        </div>
        <p className="text-xs text-slate-600 mt-2">
          GHL: Sub-Account Settings → Custom Menu Links → Add Link → Open in new tab
        </p>
      </div>
    </div>
  )
}
