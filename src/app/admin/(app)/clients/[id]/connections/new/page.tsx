// New Client Connection — /admin/clients/[id]/connections/new?connector=[connectorId]
// Assigns a specific account from an agency connector to this client.
// Calls discoverAccounts() live so the list is always fresh (falls back to cache on failure).

import { createAdminClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { Client, Connector } from '@/lib/types'
import { getConnectorDef, getConnectorAdapter } from '@/lib/connectors/registry'
import NewConnectionForm from './NewConnectionForm'

import PageHeader from '@/components/ui/PageHeader'
import BrandLogo from '@/components/ui/BrandLogo'

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
    <div style={{ maxWidth: 620 }}>
      <PageHeader
        back={{ href: `/admin/clients/${id}?tab=sources`, label: client.name }}
        leading={<BrandLogo type={connector.type} size={24} tile tileSize="xl" />}
        title={`Assign ${def.label} account`}
        description={`Pick the account or property that belongs to ${client.name}.`}
      />

      {discoveryError && (
        <div className="ui-notice ui-notice--warning" role="status">
          Couldn’t refresh the account list ({discoveryError}), so these are the accounts found last time.
        </div>
      )}

      <div className="card" style={{ padding: 20 }}>
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
