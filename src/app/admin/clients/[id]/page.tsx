import { createAdminClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { Client, AdAccount, SyncLog, AgencySettings } from '@/lib/types'
import Link from 'next/link'
import AccountMapper from './AccountMapper'
import ClientBenchmarks from './ClientBenchmarks'

export const dynamic = 'force-dynamic'

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

  const [clientResult, mappedResult, unlinkedResult, recentSyncsResult, settingsResult] = await Promise.all([
    db.from('clients').select('*').eq('id', id).single(),
    db.from('ad_accounts').select('id, platform, account_id, account_name').eq('client_id', id).order('platform').order('account_name'),
    db.from('ad_accounts').select('id, platform, account_id, account_name').is('client_id', null).order('platform').order('account_name'),
    db.from('sync_logs').select('*').eq('client_id', id).order('started_at', { ascending: false }).limit(5),
    db.from('agency_settings').select('benchmark_roas,benchmark_ctr,benchmark_cpc,benchmark_conv_rate,benchmark_cpm').single(),
  ])

  const client = clientResult.data as Client | null
  if (!client) notFound()

  const recentSyncs    = (recentSyncsResult.data ?? []) as SyncLog[]
  const allUnlinked    = (unlinkedResult.data ?? []) as AdAccount[]
  const mappedAccounts = (mappedResult.data ?? []) as AdAccount[]
  const globalSettings = (settingsResult.data ?? {
    benchmark_roas: 3, benchmark_ctr: 0.03, benchmark_cpc: 3,
    benchmark_conv_rate: 0.03, benchmark_cpm: 15,
  }) as Pick<AgencySettings, 'benchmark_roas' | 'benchmark_ctr' | 'benchmark_cpc' | 'benchmark_conv_rate' | 'benchmark_cpm'>

  const dashUrl        = `${appUrl}/api/auth/access?token=${client.dashboard_token}`
  const googleAccounts = mappedAccounts.filter(a => a.platform === 'google')
  const metaAccounts   = mappedAccounts.filter(a => a.platform === 'meta')
  const isConnected    = googleAccounts.length > 0 || metaAccounts.length > 0

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

      {/* Step 1 — Map Ad Accounts */}
      <div className="bg-[#0f1525] border border-[#1e2a40] rounded-xl p-6 mb-4">
        <div className="flex items-center gap-2 mb-1">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
            isConnected ? 'bg-emerald-500 text-white' : 'bg-blue-600 text-white'
          }`}>{isConnected ? '✓' : '1'}</div>
          <h2 className="font-semibold text-slate-100">Map Ad Accounts</h2>
        </div>
        <p className="text-xs text-slate-500 mb-4 ml-8">
          Select from discovered accounts or enter an account ID manually.
          A 730-day backfill starts automatically on mapping.
        </p>

        <AccountMapper
          clientId={id}
          unlinkedGoogle={allUnlinked.filter(a => a.platform === 'google')}
          unlinkedMeta={allUnlinked.filter(a => a.platform === 'meta')}
          mappedGoogle={googleAccounts}
          mappedMeta={metaAccounts}
        />

        {allUnlinked.length === 0 && !isConnected && (
          <p className="text-xs text-slate-600 mt-3">
            No discovered accounts yet.{' '}
            <Link href="/admin/settings" className="text-blue-400 hover:underline">
              Go to Settings → Platform Connections
            </Link>{' '}
            to sync Meta accounts or run the MCC script for Google.
          </p>
        )}
      </div>

      {/* Step 2 — Sync Data */}
      <div className="bg-[#0f1525] border border-[#1e2a40] rounded-xl p-6 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">2</div>
          <h2 className="font-semibold text-slate-100">Sync Data</h2>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          Backfill runs automatically when an account is mapped. Use this to re-sync manually.
        </p>
        <div className="flex items-center gap-3">
          <form action="/api/sync/trigger" method="POST">
            <input type="hidden" name="clientId" value={client.id} />
            <input type="hidden" name="days" value="90" />
            <button
              type="submit"
              disabled={!isConnected}
              className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Re-sync Last 90 Days
            </button>
          </form>
          {recentSyncs.length > 0 && (
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

      {/* Performance Benchmarks */}
      <div className="bg-[#0f1525] border border-[#1e2a40] rounded-xl p-6 mb-4">
        <h2 className="font-semibold text-slate-100 mb-1">Performance Benchmarks</h2>
        <p className="text-xs text-slate-500 mb-4">
          Override global benchmark targets for this client&apos;s Efficiency Score.
        </p>
        <ClientBenchmarks
          clientId={id}
          globalDefaults={globalSettings}
          current={{
            benchmark_roas:       client.benchmark_roas,
            benchmark_ctr:        client.benchmark_ctr,
            benchmark_cpc:        client.benchmark_cpc,
            benchmark_conv_rate:  client.benchmark_conv_rate,
            benchmark_cpm:        client.benchmark_cpm,
          }}
        />
      </div>

      {/* Step 3 — GHL Link */}
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
