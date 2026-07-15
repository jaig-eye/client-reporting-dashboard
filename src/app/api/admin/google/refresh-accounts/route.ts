// POST /api/admin/google/refresh-accounts
// Manually triggers Google Ads account discovery to pick up newly added sub-accounts.

import { NextResponse }          from 'next/server'
import { NextRequest }           from 'next/server'
import { cookies }               from 'next/headers'
import { createAdminClient }     from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { logActivity }           from '@/lib/activity'
import { googleAdsConnector }    from '@/lib/connectors/google-ads'
import type { Connector }        from '@/lib/types'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const adminSession = await getAdminSession()
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()

  const db = createAdminClient()

  const { data: connectors } = await db
    .from('connectors')
    .select('*')
    .eq('type', 'google_ads')

  const rows    = (connectors ?? []) as Connector[]
  const results: { id: string; label: string; accounts: number; error?: string }[] = []

  for (const connector of rows) {
    const auth   = (connector.auth   ?? {}) as Record<string, unknown>
    const config = (connector.config ?? {}) as Record<string, unknown>
    let currentAuth = auth

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
      results.push({ id: connector.id, label: connector.label ?? connector.id, accounts: 0, error: msg })
    }
  }

  logActivity(adminSession, 'synced', 'connector', {
    ip,
    meta: { type: 'google_ads_account_refresh', connectors: results.length },
  })
  return NextResponse.json({ refreshed: results.length, results })
}
