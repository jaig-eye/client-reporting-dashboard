// Daily cron — refreshes discovered accounts for all Google Ads connectors.
// Keeps the connector_accounts table fresh so the client connection dropdown
// always shows the latest sub-accounts without requiring a manual refresh.

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeCompare } from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase/server'
import { googleAdsConnector }        from '@/lib/connectors/google-ads'
import type { Connector }            from '@/lib/types'

export const maxDuration = 120

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!timingSafeCompare(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  const { data: connectors } = await db
    .from('connectors')
    .select('*')
    .eq('type', 'google_ads')

  const rows = (connectors ?? []) as Connector[]
  const results: { id: string; label: string; accounts: number; error?: string }[] = []

  for (const connector of rows) {
    const auth   = (connector.auth   ?? {}) as Record<string, unknown>
    const config = (connector.config ?? {}) as Record<string, unknown>

    let currentAuth = auth

    // Refresh token if needed before discovery
    try {
      const refreshed = await googleAdsConnector.refreshAuth!(currentAuth)
      if (refreshed) {
        currentAuth = refreshed as Record<string, unknown>
        await db.from('connectors').update({ auth: currentAuth }).eq('id', connector.id)
      }
    } catch (e) {
      console.warn(`[refresh-accounts] token refresh failed for ${connector.id}:`, e)
    }

    try {
      const accounts = await googleAdsConnector.discoverAccounts(currentAuth, config)

      if (accounts.length > 0) {
        await db.from('connector_accounts').upsert(
          accounts.map(a => ({
            connector_id:  connector.id,
            external_id:   a.external_id,
            external_name: a.external_name,
            metadata:      a.metadata ?? null,
          })),
          { onConflict: 'connector_id,external_id', ignoreDuplicates: false }
        )
      }

      results.push({ id: connector.id, label: connector.label ?? connector.id, accounts: accounts.length })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[refresh-accounts] failed for connector ${connector.id}:`, msg)
      results.push({ id: connector.id, label: connector.label ?? connector.id, accounts: 0, error: msg })
    }
  }

  return NextResponse.json({ refreshed: results.length, results })
}
