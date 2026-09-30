// Daily cron — refreshes discovered accounts for every connector that can discover them.
// Keeps the connector_accounts table fresh so the client connection dropdown
// always shows the latest sub-accounts without requiring a manual refresh.
//
// This used to query google_ads only, so a GA4 property or a Search Console site added after
// the connector was authorised never appeared on its own: the cache only moved when somebody
// opened /api/admin/connectors/[id]/discover by hand. Google Ads looked reliable purely
// because this cron was refreshing it nightly and the others had no equivalent.

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase/server'
import { getConnectorAdapter }       from '@/lib/connectors/registry'
import { sendDiscordMessage }        from '@/lib/discord'
import { getNotif, type NotifConfig } from '@/lib/notificationConfig'
import type { Connector, ConnectorType } from '@/lib/types'

export const maxDuration = 120

/** Warn this many days before a stored token expires. */
const TOKEN_WARN_DAYS = 10

/**
 * Connector types whose accounts are worth re-discovering daily.
 *
 * Each is an agency-level connector holding one OAuth identity that can see many client
 * accounts, so the set genuinely changes over time. Connectors configured per client
 * (WordPress, BigCommerce, GHL, Ahrefs, DataForSEO) have nothing to enumerate.
 */
const REFRESHABLE: ConnectorType[] = [
  'google_ads',
  'google_analytics',
  'google_search_console',
  'google_business_profile',
  'meta_ads',
]

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!verifyCronAuth(authHeader)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  const { data: connectors } = await db
    .from('connectors')
    .select('*')
    .in('type', REFRESHABLE)

  const rows = (connectors ?? []) as Connector[]
  const results: { id: string; type: string; label: string; accounts: number; error?: string }[] = []

  for (const connector of rows) {
    const auth   = (connector.auth   ?? {}) as Record<string, unknown>
    const config = (connector.config ?? {}) as Record<string, unknown>

    const adapter = getConnectorAdapter(connector.type)
    if (!adapter) continue

    let currentAuth = auth

    // Refresh token if needed before discovery. Google access tokens last about an hour, so a
    // daily cron is always holding an expired one — without this the request 401s and the
    // refresh accomplishes nothing. Meta's long-lived tokens have no refreshAuth; the optional
    // call is what lets one loop serve both.
    if (adapter.refreshAuth) {
      try {
        const refreshed = await adapter.refreshAuth(currentAuth)
        if (refreshed) {
          currentAuth = refreshed as Record<string, unknown>
          await db.from('connectors').update({ auth: currentAuth }).eq('id', connector.id)
        }
      } catch (e) {
        console.warn(`[refresh-accounts] token refresh failed for ${connector.type} ${connector.id}:`, e)
      }
    }

    try {
      const accounts = await adapter.discoverAccounts(currentAuth, config)

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

      results.push({ id: connector.id, type: connector.type, label: connector.label ?? connector.id, accounts: accounts.length })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[refresh-accounts] failed for connector ${connector.type} ${connector.id}:`, msg)
      results.push({ id: connector.id, type: connector.type, label: connector.label ?? connector.id, accounts: 0, error: msg })
    }
  }

  const health = await reportConnectorHealth(db)

  return NextResponse.json({ refreshed: results.length, results, health })
}

/**
 * Say when a connector has stopped working, or is about to.
 *
 * Two failures went unreported for exactly as long as it took a human to notice something
 * missing. The agency Meta token expired at 09:02 one morning and every sync for seventeen
 * clients failed from that minute; sync_jobs recorded the reason perfectly — OAuthException code
 * 190, "Session has expired" — and nothing read it. The connections page meanwhile showed
 * "connected", because that reads a stored status column set when somebody first authorised and
 * never re-checked since.
 *
 * The sync cron DOES have an auth alert, wired to the same sync_connector_error setting — but it
 * only fires when syncClient REJECTS. Per-connection failures are caught inside and recorded as a
 * sync_jobs row, so the promise fulfils, the auth branch never runs, and the alert that exists for
 * exactly this went unsent for all seventeen. Reading the rows rather than the rejections is what
 * closes that.
 *
 * So this looks at both ends: tokens with a known expiry date coming up, and auth failures that
 * have already happened.
 */
async function reportConnectorHealth(db: ReturnType<typeof createAdminClient>) {
  const problems: string[] = []

  // ── Expiring soon ─────────────────────────────────────────────────────────
  try {
    const { data: conns } = await db.from('connectors').select('type, auth')
    const horizon = new Date(Date.now() + TOKEN_WARN_DAYS * 86_400_000).toISOString()
    const now     = new Date().toISOString()
    for (const c of (conns ?? []) as { type: string; auth: Record<string, unknown> | null }[]) {
      const exp = c.auth?.token_expires_at
      if (typeof exp !== 'string' || !exp) continue
      if (exp > horizon) continue
      const days = Math.round((Date.parse(exp) - Date.now()) / 86_400_000)
      problems.push(exp < now
        ? `${c.type}: token EXPIRED ${Math.abs(days)} day(s) ago — reconnect in Agency Settings`
        : `${c.type}: token expires in ${days} day(s) — reconnect before it does`)
    }
  } catch (e) {
    console.warn('[refresh-accounts] token expiry check failed:', e)
  }

  // ── Already failing ───────────────────────────────────────────────────────
  // Grouped by connector type rather than listed per client: one expired agency token produces a
  // failure row for every client using it, and seventeen identical lines is a worse alert than one.
  try {
    const since = new Date(Date.now() - 86_400_000).toISOString()
    const { data: failures } = await db
      .from('sync_jobs')
      .select('error_message, connection_id, client_connections(connectors(type))')
      .eq('status', 'error')
      .gte('started_at', since)
      .limit(500)

    const authFailures = new Map<string, number>()
    for (const row of (failures ?? []) as { error_message: string | null; client_connections: unknown }[]) {
      const msg = row.error_message ?? ''
      // The signatures that mean "our credential is dead", not "this one request went wrong".
      if (!/OAuthException|code\D*190|access token|token has expired|invalid_grant|401|invalid_client/i.test(msg)) continue
      const cc   = row.client_connections as { connectors?: { type?: string } | { type?: string }[] } | null
      const conn = Array.isArray(cc?.connectors) ? cc?.connectors[0] : cc?.connectors
      const type = conn?.type ?? 'unknown'
      authFailures.set(type, (authFailures.get(type) ?? 0) + 1)
    }
    for (const [type, count] of Array.from(authFailures)) {
      problems.push(`${type}: ${count} sync(s) failed authentication in the last 24h — the credential needs reconnecting`)
    }
  } catch (e) {
    console.warn('[refresh-accounts] auth failure scan failed:', e)
  }

  if (problems.length === 0) return { problems: 0 }

  const body = problems.join('\n')
  console.error(`[refresh-accounts] CONNECTOR HEALTH:\n${body}`)

  // In-app alert first: it is the one channel that cannot be misconfigured, and an agency with
  // no Discord set up would otherwise get nothing at all.
  const { error: alertErr } = await db.from('admin_alerts').insert({
    type:     'system',
    severity: 'critical',
    title:    `${problems.length} connector credential${problems.length === 1 ? '' : 's'} need attention`,
    body,
    link_url: '/admin/connections',
  })
  if (alertErr) console.error('[refresh-accounts] admin_alerts insert failed:', alertErr.message)

  try {
    const { data: settings } = await db
      .from('agency_settings')
      .select('discord_bot_token, discord_ops_channel_id, notification_config')
      .maybeSingle()
    const notif = getNotif((settings?.notification_config ?? null) as NotifConfig | null, 'sync_connector_error')
    if (notif.agency) {
      const botToken   = (settings?.discord_bot_token as string | null) ?? null
      const opsChannel = ((settings?.discord_ops_channel_id as string | null) ?? process.env.DISCORD_OPS_CHANNEL_ID) ?? null
      if (botToken && opsChannel) {
        await sendDiscordMessage(botToken, opsChannel, `**Connector credentials need attention**
${body}`)
      }
    }
  } catch (e) {
    console.warn('[refresh-accounts] could not send connector health notice:', e)
  }

  return { problems: problems.length, detail: problems }
}
