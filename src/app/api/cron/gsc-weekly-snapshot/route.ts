import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import {
  fetchSearchAnalytics,
  refreshAccessToken,
  isExpiringSoon,
} from '@/lib/connectors/google-search-console'
import type { GSCPageFilter } from '@/lib/connectors/google-search-console'
import { upsertGSCMetrics } from '@/lib/sync'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!verifyCronAuth(authHeader)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db        = createAdminClient()
  const checkedAt = new Date().toISOString()

  const sevenDaysAgo = new Date(Date.now() - 7  * 86_400_000).toISOString().slice(0, 10)
  const yesterday    = new Date(Date.now() - 1  * 86_400_000).toISOString().slice(0, 10)

  // Load all active GSC connections with their connector auth
  const { data: connections } = await db
    .from('client_connections')
    .select('id, external_id, config, connector_id, client_id, connectors!inner(auth, type)')
    .eq('connectors.type', 'google_search_console')
    .eq('status', 'active')

  type ConnAuth = { access_token: string; refresh_token: string; token_expires_at?: string }
  type ConnRow  = {
    id:           string
    external_id:  string
    config:       Record<string, unknown> | null
    connector_id: string
    client_id:    string
    connectors:   { auth: ConnAuth } | null
  }

  const rows = (connections ?? []) as unknown as ConnRow[]

  let snapshotted = 0
  let errored     = 0

  for (const conn of rows) {
    try {
      const connectors = conn.connectors
      if (!connectors) continue

      let auth = connectors.auth

      if (isExpiringSoon(auth.token_expires_at)) {
        const refreshed = await refreshAccessToken(auth.refresh_token)
        auth = {
          ...auth,
          access_token:     refreshed.access_token,
          token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any).from('connectors').update({ auth }).eq('id', conn.connector_id)
      }

      const siteUrl = conn.external_id as string
      if (!siteUrl) continue

      const cfg = conn.config as Record<string, unknown> | null
      const pageFilter: GSCPageFilter | undefined = cfg?.page_filter_regex && typeof cfg.page_filter_regex === 'string'
        ? { regex: cfg.page_filter_regex, type: ((cfg.page_filter_type as string | undefined) ?? 'exclude') as 'include' | 'exclude' }
        : undefined

      const rawRows = await fetchSearchAnalytics(
        siteUrl,
        auth.access_token,
        sevenDaysAgo,
        yesterday,
        'all',
        ['date', 'query', 'page'],
        pageFilter,
      )

      if (rawRows.length > 0) {
        await upsertGSCMetrics(db, conn.id, conn.client_id, rawRows, false)
      }

      snapshotted++
    } catch (err) {
      console.error('[gsc-weekly-snapshot] connection', conn.id, err)
      errored++
    }
  }

  // Prune gsc_metrics rows older than 4 months (120 days)
  const cutoff = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10)
  await db.from('gsc_metrics').delete().lt('date', cutoff)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).from('cron_heartbeats').upsert({
    cron_name:   'gsc-weekly-snapshot',
    last_run_at: checkedAt,
    last_result: `snapshotted ${snapshotted} connections, ${errored} errors`,
  })

  return NextResponse.json({ ok: true, snapshotted, errored })
}
