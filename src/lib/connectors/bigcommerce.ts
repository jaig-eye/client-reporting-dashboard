// ─────────────────────────────────────────────────────────────────────────────
// BigCommerce Connector
//
// Write-only connector for publishing blog content to BigCommerce Blog API.
// No metric sync — used purely for content automation.
//
// Auth/config object shape (stored in connectors.auth or connectors.config):
//   { store_hash: string, access_token: string }
// ─────────────────────────────────────────────────────────────────────────────

import type { ConnectorAdapter, SyncResult, DiscoveredAccount } from './types'

export const bigcommerceConnector: ConnectorAdapter = {
  type: 'bigcommerce',

  async fetchMetrics(): Promise<SyncResult> {
    return { rows: [] }
  },

  async discoverAccounts(
    auth: Record<string, unknown>,
    config: Record<string, unknown>
  ): Promise<DiscoveredAccount[]> {
    const storeHash   = String(config.store_hash   || auth.store_hash   || '')
    const accessToken = String(config.access_token || auth.access_token || '')
    if (!storeHash || !accessToken) return []
    try {
      const res = await fetch(
        `https://api.bigcommerce.com/stores/${storeHash}/v2/store`,
        { headers: { 'X-Auth-Token': accessToken, Accept: 'application/json' } }
      )
      if (!res.ok) return []
      const data = (await res.json()) as Record<string, unknown>
      return [{
        external_id:   storeHash,
        external_name: String(data.name || `BigCommerce (${storeHash})`),
        metadata:      { domain: data.domain },
      }]
    } catch {
      return []
    }
  },

  async testConnection(
    auth: Record<string, unknown>,
    config: Record<string, unknown>
  ): Promise<boolean> {
    const storeHash   = String(config.store_hash   || auth.store_hash   || '')
    const accessToken = String(config.access_token || auth.access_token || '')
    if (!storeHash || !accessToken) return false
    try {
      // Test against /v2/blog/posts specifically — requires Content scope.
      // /v2/store passes with any scope and would miss missing Content permission.
      const res = await fetch(
        `https://api.bigcommerce.com/stores/${storeHash}/v2/blog/posts?limit=1`,
        { headers: { 'X-Auth-Token': accessToken, Accept: 'application/json' } }
      )
      return res.ok
    } catch {
      return false
    }
  },
}
