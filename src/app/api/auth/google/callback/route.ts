// GET /api/auth/google/callback
// Handles Google OAuth callback for all Google connector types:
//   google_ads | google_analytics | google_search_console | google_business_profile
//
// Two modes:
//   unified  — stateData.mode === 'unified' (no connector_type in state)
//              Upserts all 4 Google connector types with the same token set.
//              Triggered when connector_type param is absent or 'google' in /start.
//   single   — stateData.connector_type is a specific type (backward compat)
//              Upserts only that connector type.

import { NextRequest } from 'next/server'
import { exchangeGoogleCode, googleAdsConnector } from '@/lib/connectors/google-ads'
import { googleAnalyticsConnector }               from '@/lib/connectors/google-analytics'
import { googleSearchConsoleConnector }           from '@/lib/connectors/google-search-console'
import { googleBusinessProfileConnector }         from '@/lib/connectors/google-business-profile'
import { createAdminClient }                      from '@/lib/supabase/server'
import { decodeState, verifyOAuthCallback, finishOAuth, type OAuthState } from '@/lib/oauthFlow'
import type { ConnectorType }                     from '@/lib/types'

const CONNECTOR_META: Record<string, { label: string; type: ConnectorType }> = {
  google_ads:              { label: 'Google Ads',              type: 'google_ads' },
  google_analytics:        { label: 'Google Analytics (GA4)',  type: 'google_analytics' },
  google_search_console:   { label: 'Google Search Console',  type: 'google_search_console' },
  google_business_profile: { label: 'Google Business Profile',type: 'google_business_profile' },
}

const GOOGLE_ALL_TYPES = [
  'google_ads',
  'google_analytics',
  'google_search_console',
  'google_business_profile',
] as const

async function discoverForConnector(
  type: ConnectorType,
  connectorId: string,
  auth: Record<string, unknown>,
  config: Record<string, unknown>,
  db: ReturnType<typeof createAdminClient>
) {
  let accounts: { external_id: string; external_name: string | null }[] = []

  if (type === 'google_ads') {
    accounts = await googleAdsConnector.discoverAccounts(auth, config)
  } else if (type === 'google_analytics') {
    accounts = await googleAnalyticsConnector.discoverAccounts(auth, config)
  } else if (type === 'google_search_console') {
    accounts = await googleSearchConsoleConnector.discoverAccounts(auth, config)
  } else if (type === 'google_business_profile') {
    accounts = await googleBusinessProfileConnector.discoverAccounts(auth, config)
  }

  if (accounts.length > 0) {
    await db.from('connector_accounts').upsert(
      accounts.map(a => ({
        connector_id:  connectorId,
        external_id:   a.external_id,
        external_name: a.external_name,
      })),
      { onConflict: 'connector_id,external_id', ignoreDuplicates: false }
    )
  }
}

export async function GET(request: NextRequest) {
  const code   = request.nextUrl.searchParams.get('code')

  // Decode state (malformed state falls through to unified mode — and then fails the nonce check).
  const stateData = decodeState(request.nextUrl.searchParams.get('state')) as OAuthState & {
    mode?:            string
    connector_type?:  string
    developer_token?: string
    mcc_customer_id?: string
  }
  const done = (ok: boolean, path: string, error?: string) =>
    finishOAuth(request, stateData, { ok, provider: 'google', path, error })

  if (!code) {
    return done(false, '/admin/connections?error=google_auth_failed', 'Google sign-in was cancelled or denied.')
  }

  // Only the signed-in admin who started this flow may complete it (see lib/oauthFlow).
  const rejected = await verifyOAuthCallback(request, stateData)
  if (rejected) return done(false, '/admin/connections?error=google_auth_failed', rejected)

  try {
    const tokens    = await exchangeGoogleCode(code)
    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString()

    const db = createAdminClient()

    // ── UNIFIED MODE — upsert all 4 Google connectors ──────────────────────────
    if (stateData.mode === 'unified' || (!stateData.connector_type && !stateData.mode)) {
      // Phase 1: upsert all 4 connector rows — do this first, sequentially,
      // before any API discovery calls that could hang.
      const savedConnectors: { connType: ConnectorType; id: string; auth: Record<string, unknown>; config: Record<string, unknown> }[] = []

      for (const connType of GOOGLE_ALL_TYPES) {
        // Preserve existing auth + config for this type
        // Select id too so we can UPDATE by PK rather than upsert by type
        // (ON CONFLICT (type) doesn't work with the partial unique index)
        const { data: existing } = await db
          .from('connectors')
          .select('id, auth, config')
          .eq('type', connType)
          .maybeSingle()

        const existingAuth   = (existing?.auth   ?? {}) as Record<string, unknown>
        const existingConfig = (existing?.config  ?? {}) as Record<string, unknown>

        const auth: Record<string, unknown> = {
          ...existingAuth,
          access_token:     tokens.access_token,
          refresh_token:    tokens.refresh_token || existingAuth.refresh_token,
          token_expires_at: expiresAt,
        }

        const config: Record<string, unknown> = { ...existingConfig }

        // Google Ads extras from state
        if (connType === 'google_ads') {
          if (stateData.developer_token) auth.developer_token = stateData.developer_token
          if (stateData.mcc_customer_id) config.mcc_customer_id = stateData.mcc_customer_id
        }

        // Use UPDATE if the row exists, INSERT otherwise.
        // Avoids relying on ON CONFLICT (type) which doesn't work against the
        // partial unique index (connectors_singleton_type_unique).
        let savedId: string | null = null
        let saveError: unknown = null

        if (existing?.id) {
          const { data, error } = await db
            .from('connectors')
            .update({ label: CONNECTOR_META[connType].label, auth, config, status: 'active' })
            .eq('id', existing.id)
            .select('id')
            .single()
          savedId  = data?.id ?? null
          saveError = error
        } else {
          const { data, error } = await db
            .from('connectors')
            .insert({ type: connType, label: CONNECTOR_META[connType].label, auth, config, status: 'active' })
            .select('id')
            .single()
          savedId  = data?.id ?? null
          saveError = error
        }

        if (saveError || !savedId) {
          console.error(`[google/callback] Unified save failed for ${connType}:`, saveError)
        } else {
          savedConnectors.push({ connType, id: savedId, auth, config })
        }
      }

      // Phase 2: fire discovery as fire-and-forget so hanging API calls
      // (e.g. GA4/GSC/GBP APIs not yet enabled) can't block the redirect.
      for (const { connType, id, auth, config } of savedConnectors) {
        discoverForConnector(connType, id, auth, config, db)
          .catch(e => console.warn(`[google/callback] Discovery failed for ${connType} (non-fatal):`, e))
      }

      return done(true, '/admin/connections?connected=google')
    }

    // ── SINGLE MODE — backward compat for per-type links ───────────────────────
    const connectorType = stateData.connector_type ?? 'google_ads'
    const meta          = CONNECTOR_META[connectorType] ?? CONNECTOR_META.google_ads

    const { data: existing } = await db
      .from('connectors')
      .select('id, auth, config')
      .eq('type', meta.type)
      .maybeSingle()

    const existingAuth   = (existing?.auth   ?? {}) as Record<string, unknown>
    const existingConfig = (existing?.config  ?? {}) as Record<string, unknown>

    const auth: Record<string, unknown> = {
      ...existingAuth,
      access_token:     tokens.access_token,
      refresh_token:    tokens.refresh_token || existingAuth.refresh_token,
      token_expires_at: expiresAt,
    }

    const config: Record<string, unknown> = { ...existingConfig }

    if (meta.type === 'google_ads') {
      if (stateData.developer_token) auth.developer_token = stateData.developer_token
      if (stateData.mcc_customer_id) config.mcc_customer_id = stateData.mcc_customer_id
    }

    // Explicit UPDATE/INSERT to avoid relying on ON CONFLICT (type) against the
    // partial unique index (connectors_singleton_type_unique).
    let connector: { id: string } | null = null
    let error: unknown = null

    if (existing?.id) {
      const { data, error: e } = await db
        .from('connectors')
        .update({ label: meta.label, auth, config, status: 'active' })
        .eq('id', existing.id)
        .select('id')
        .single()
      connector = data
      error     = e
    } else {
      const { data, error: e } = await db
        .from('connectors')
        .insert({ type: meta.type, label: meta.label, auth, config, status: 'active' })
        .select('id')
        .single()
      connector = data
      error     = e
    }

    if (error || !connector) {
      console.error('Google connector save failed:', error)
      return done(false, '/admin/connections?error=google_save_failed', 'Google signed in, but the connection couldn’t be saved. Try again.')
    }

    try {
      await discoverForConnector(meta.type, connector.id, auth, config, db)
    } catch (e) {
      console.warn(`${meta.label} account discovery failed (non-fatal):`, e)
    }

    return done(true, `/admin/connections/${connector.id}?connected=${meta.type}`)
  } catch (e) {
    console.error('Google callback error:', e)
    return done(false, '/admin/connections?error=google_failed', 'Google connection failed. Try again in a minute.')
  }
}
