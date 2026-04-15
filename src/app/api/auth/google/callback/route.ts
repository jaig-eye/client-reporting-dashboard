// GET /api/auth/google/callback
// Handles Google OAuth callback for all Google connector types:
//   google_ads | google_analytics | google_search_console | google_business_profile
// The connector_type is recovered from the OAuth state param.

import { NextRequest, NextResponse } from 'next/server'
import { exchangeGoogleCode, googleAdsConnector } from '@/lib/connectors/google-ads'
import { googleAnalyticsConnector }               from '@/lib/connectors/google-analytics'
import { googleSearchConsoleConnector }           from '@/lib/connectors/google-search-console'
import { googleBusinessProfileConnector }         from '@/lib/connectors/google-business-profile'
import { createAdminClient }                      from '@/lib/supabase/server'
import type { ConnectorType }                     from '@/lib/types'

const CONNECTOR_META: Record<string, { label: string; type: ConnectorType }> = {
  google_ads:              { label: 'Google Ads',              type: 'google_ads' },
  google_analytics:        { label: 'Google Analytics (GA4)',  type: 'google_analytics' },
  google_search_console:   { label: 'Google Search Console',  type: 'google_search_console' },
  google_business_profile: { label: 'Google Business Profile',type: 'google_business_profile' },
}

export async function GET(request: NextRequest) {
  const code   = request.nextUrl.searchParams.get('code')
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')

  if (!code) {
    return NextResponse.redirect(`${appUrl}/admin/connections?error=google_auth_failed`)
  }

  try {
    const tokens    = await exchangeGoogleCode(code)
    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString()

    const db = createAdminClient()

    // Decode state to recover connector_type + optional Google Ads params
    let stateData: {
      connector_type?:  string
      developer_token?: string
      mcc_customer_id?: string
    } = {}
    const stateParam = request.nextUrl.searchParams.get('state')
    if (stateParam) {
      try {
        stateData = JSON.parse(Buffer.from(stateParam, 'base64url').toString())
      } catch {
        // ignore malformed state — fall back to google_ads
      }
    }

    const connectorType = stateData.connector_type ?? 'google_ads'
    const meta          = CONNECTOR_META[connectorType] ?? CONNECTOR_META.google_ads

    // Preserve existing auth + config for this connector type (re-auth flow)
    const { data: existing } = await db
      .from('connectors')
      .select('auth, config')
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

    // Google Ads extras
    if (meta.type === 'google_ads') {
      if (stateData.developer_token) auth.developer_token = stateData.developer_token
      if (stateData.mcc_customer_id) config.mcc_customer_id = stateData.mcc_customer_id
    }

    // Upsert the connector (one row per type)
    const { data: connector, error } = await db
      .from('connectors')
      .upsert({
        type:   meta.type,
        label:  meta.label,
        auth,
        config,
        status: 'active',
      }, { onConflict: 'type' })
      .select('id')
      .single()

    if (error || !connector) {
      console.error('Google connector upsert failed:', error)
      return NextResponse.redirect(`${appUrl}/admin/connections?error=google_save_failed`)
    }

    // Discover accounts / properties for the assignment dropdown
    try {
      let accounts: { external_id: string; external_name: string | null }[] = []

      if (meta.type === 'google_ads') {
        accounts = await googleAdsConnector.discoverAccounts(auth, config)
      } else if (meta.type === 'google_analytics') {
        accounts = await googleAnalyticsConnector.discoverAccounts(auth, config)
      } else if (meta.type === 'google_search_console') {
        accounts = await googleSearchConsoleConnector.discoverAccounts(auth, config)
      } else if (meta.type === 'google_business_profile') {
        accounts = await googleBusinessProfileConnector.discoverAccounts(auth, config)
      }

      if (accounts.length > 0) {
        await db.from('connector_accounts').upsert(
          accounts.map(a => ({
            connector_id:  connector.id,
            external_id:   a.external_id,
            external_name: a.external_name,
          })),
          { onConflict: 'connector_id,external_id', ignoreDuplicates: false }
        )
      }
    } catch (e) {
      console.warn(`${meta.label} account discovery failed (non-fatal):`, e)
    }

    return NextResponse.redirect(`${appUrl}/admin/connections/${connector.id}?connected=${meta.type}`)
  } catch (e) {
    console.error('Google callback error:', e)
    return NextResponse.redirect(`${appUrl}/admin/connections?error=google_failed`)
  }
}
