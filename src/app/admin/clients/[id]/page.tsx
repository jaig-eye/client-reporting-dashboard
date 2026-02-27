import { createAdminClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { Client, AdAccount } from '@/lib/types'
import Link from 'next/link'

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = createAdminClient()

  const { data: client } = await db
    .from('clients')
    .select('*, ad_accounts(*)')
    .eq('id', id)
    .single() as { data: (Client & { ad_accounts: AdAccount[] }) | null }

  if (!client) notFound()

  const googleAuthUrl = `/api/auth/google?clientId=${client.id}`
  const metaAuthUrl = `/api/auth/meta?clientId=${client.id}`

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin" className="text-sm text-gray-400 hover:text-gray-600">← Clients</Link>
        <h2 className="text-lg font-semibold text-gray-900">{client.name}</h2>
      </div>

      {/* Client Info */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Client Details</h3>
        <dl className="space-y-2 text-sm">
          <div className="flex gap-4">
            <dt className="text-gray-500 w-24">Email</dt>
            <dd className="text-gray-900">{client.email}</dd>
          </div>
          <div className="flex gap-4">
            <dt className="text-gray-500 w-24">Slug</dt>
            <dd className="text-gray-900">{client.slug}</dd>
          </div>
          <div className="flex gap-4">
            <dt className="text-gray-500 w-24">Dashboard</dt>
            <dd>
              <a href="/dashboard" target="_blank" className="text-blue-600 hover:underline">/dashboard</a>
            </dd>
          </div>
        </dl>
      </div>

      {/* Ad Accounts */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Ad Accounts</h3>

        {(client.ad_accounts || []).length > 0 ? (
          <div className="space-y-2 mb-4">
            {client.ad_accounts.map(acc => (
              <div key={acc.id} className="flex items-center justify-between py-2 border-b border-gray-50">
                <div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium mr-2 ${
                    acc.platform === 'google' ? 'bg-blue-50 text-blue-700' : 'bg-indigo-50 text-indigo-700'
                  }`}>
                    {acc.platform === 'google' ? 'Google Ads' : 'Meta'}
                  </span>
                  <span className="text-sm text-gray-700">{acc.account_name || acc.account_id}</span>
                </div>
                <form action="/api/admin/accounts/remove" method="POST">
                  <input type="hidden" name="accountId" value={acc.id} />
                  <button type="submit" className="text-xs text-red-400 hover:text-red-600">Remove</button>
                </form>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400 mb-4">No ad accounts linked yet</p>
        )}

        <div className="flex gap-3">
          <a
            href={googleAuthUrl}
            className="flex-1 text-center text-sm border border-gray-200 rounded-lg py-2 hover:border-gray-300 text-gray-700"
          >
            + Connect Google Ads
          </a>
          <a
            href={metaAuthUrl}
            className="flex-1 text-center text-sm border border-gray-200 rounded-lg py-2 hover:border-gray-300 text-gray-700"
          >
            + Connect Meta
          </a>
        </div>
      </div>

      {/* Send invite */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Client Access</h3>
        <p className="text-xs text-gray-500 mb-3">
          Send the client a magic link so they can access their dashboard.
        </p>
        <form action="/api/admin/invite" method="POST">
          <input type="hidden" name="clientId" value={client.id} />
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            Send Dashboard Invite
          </button>
        </form>
      </div>
    </div>
  )
}
