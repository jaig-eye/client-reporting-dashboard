// New Client Connection — /admin/clients/[id]/connections/new?connector=[connectorId]
// Assigns a specific account from an agency connector to this client.
// Calls discoverAccounts() live so the list is always fresh (falls back to cache on failure).

import { createAdminClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Client, Connector } from '@/lib/types'
import { getConnectorDef, getConnectorAdapter } from '@/lib/connectors/registry'
import NewConnectionForm from './NewConnectionForm'

export const dynamic = 'force-dynamic'

export default async function NewClientConnectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ connector?: string }>
}) {
  const { id } = await params
  const sp = await searchParams
  const connectorId = sp.connector

  if (!connectorId) notFound()

  const db = createAdminClient()

  const [clientRes, connectorRes] = await Promise.all([
    db.from('clients').select('id, name').eq('id', id).single(),
    db.from('connectors').select('*').eq('id', connectorId).single(),
  ])

  const client    = clientRes.data as Client | null
  const connector = connectorRes.data as Connector | null

  if (!client || !connector) notFound()

  const def     = getConnectorDef(connector.type)
  const adapter = getConnectorAdapter(connector.type)

  let auth     = (connector.auth   ?? {}) as Record<string, unknown>
  const config = (connector.config ?? {}) as Record<string, unknown>

  // Try live discovery first — always fresh, no stale cache
  let discoveredAccounts: { external_id: string; external_name: string | null }[] = []
  let discoveryError: string | null = null

  // Refresh the access token before asking, exactly as /api/admin/connectors/[id]/discover
  // does. Google access tokens last about an hour; without this, opening the picker a day
  // after the connector was authorised sent an expired token, the API answered 401, and the
  // adapter returned an empty list — which this page then silently replaced with the cache.
  // A property added since the last manual refresh was therefore invisible here, with nothing
  // on screen saying the list was stale.
  if (adapter?.refreshAuth) {
    try {
      const refreshed = await adapter.refreshAuth(auth)
      if (refreshed) {
        auth = refreshed as Record<string, unknown>
        await db.from('connectors').update({ auth }).eq('id', connectorId)
      }
    } catch (e) {
      // Carry on with the stored token: it may still be valid, and discovery reports its own
      // failure below. Only note it so the banner can say the list may be stale.
      discoveryError = `token refresh failed (${e instanceof Error ? e.message : String(e)})`
    }
  }

  async function loadCachedAccounts() {
    const cached = await db.from('connector_accounts')
      .select('external_id, external_name')
      .eq('connector_id', connectorId!)
      .order('external_name')
    return (cached.data ?? []) as { external_id: string; external_name: string | null }[]
  }

  if (adapter) {
    try {
      const live = await adapter.discoverAccounts(auth, config)
      if (live.length > 0) {
        // Live answered. Whatever happened to the token refresh, the list in front of the user
        // is current, so no staleness warning.
        discoveryError = null
        discoveredAccounts = live.map(a => ({ external_id: a.external_id, external_name: a.external_name ?? null }))
        // Update cache in background (don't await)
        void Promise.resolve(
          db.from('connector_accounts').upsert(
            live.map(a => ({
              connector_id:  connectorId,
              external_id:   a.external_id,
              external_name: a.external_name ?? null,
              metadata:      a.metadata ?? null,
            })),
            { onConflict: 'connector_id,external_id', ignoreDuplicates: false }
          )
        ).catch(() => {})
      } else {
        // Live returned empty (e.g. MCC-script setup, expired token) — use cache
        discoveredAccounts = await loadCachedAccounts()
      }
    } catch (e) {
      discoveryError = e instanceof Error ? e.message : 'Account discovery failed'
      discoveredAccounts = await loadCachedAccounts()
    }
  } else {
    // No adapter — use cache only
    discoveredAccounts = await loadCachedAccounts()
  }

  return (
    <div className="max-w-lg">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6 text-sm flex-wrap">
        <Link href="/admin/clients" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
          Clients
        </Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <Link href={`/admin/clients/${id}`} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
          {client.name}
        </Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Connect {def.label}</span>
      </div>

      <div className="card p-6">
        <div className="flex items-center gap-3 mb-5">
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
            style={{ background: def.color }}
          >
            {def.icon}
          </div>
          <div>
            <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              Connect {def.label} for {client.name}
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Assign an ad account or property to this client.
            </p>
          </div>
        </div>

        {discoveryError && (
          <div className="rounded-xl px-4 py-3 text-sm mb-4"
            style={{ background: 'var(--amber-subtle, #fffbeb)', border: '1px solid #fde68a', color: '#92400e' }}>
            Could not refresh account list: {discoveryError}. Showing cached results.
          </div>
        )}

        <NewConnectionForm
          clientId={id}
          connectorId={connectorId}
          connectorType={connector.type}
          discoveredAccounts={discoveredAccounts}
        />
      </div>
    </div>
  )
}
