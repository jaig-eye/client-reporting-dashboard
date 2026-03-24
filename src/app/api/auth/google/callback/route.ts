import { NextRequest, NextResponse } from 'next/server'
import { exchangeGoogleCode, googleAdsConnector } from '@/lib/connectors/google-ads'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const code    = request.nextUrl.searchParams.get('code')
  const appUrl  = process.env.NEXT_PUBLIC_APP_URL!

  if (!code) {
    return NextResponse.redirect(`${appUrl}/admin/connections?error=google_auth_failed`)
  }

  try {
    const tokens    = await exchangeGoogleCode(code)
    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString()

    const db = createAdminClient()

    // Decode state to recover developer_token and mcc_customer_id passed from the start route
    let stateData: { developer_token?: string; mcc_customer_id?: string } = {}
    const stateParam = request.nextUrl.searchParams.get('state')
    if (stateParam) {
      try {
        stateData = JSON.parse(Buffer.from(stateParam, 'base64url').toString())
      } catch {
        // ignore malformed state
      }
    }

    // Preserve existing auth fields (developer_token etc.) and config when re-authorizing
    const { data: existing } = await db
      .from('connectors')
      .select('auth, config')
      .eq('type', 'google_ads')
      .maybeSingle()

    const existingAuth   = (existing?.auth   ?? {}) as Record<string, unknown>
    const existingConfig = (existing?.config  ?? {}) as Record<string, unknown>

    const auth = {
      ...existingAuth,
      access_token:     tokens.access_token,
      refresh_token:    tokens.refresh_token || existingAuth.refresh_token,
      token_expires_at: expiresAt,
      // Override developer_token if a new one was supplied in the flow
      ...(stateData.developer_token ? { developer_token: stateData.developer_token } : {}),
    }

    const config = {
      ...existingConfig,
      ...(stateData.mcc_customer_id ? { mcc_customer_id: stateData.mcc_customer_id } : {}),
    }

    // Upsert the agency-level Google Ads connector
    const { data: connector, error } = await db
      .from('connectors')
      .upsert({
        type:   'google_ads',
        label:  'Google Ads',
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

    // Discover accessible accounts and cache them for the assignment UI
    try {
      const accounts = await googleAdsConnector.discoverAccounts(auth, {})
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
      console.warn('Google account discovery failed (non-fatal):', e)
    }

    return NextResponse.redirect(`${appUrl}/admin/connections/${connector.id}?connected=google`)
  } catch (e) {
    console.error('Google callback error:', e)
    return NextResponse.redirect(`${appUrl}/admin/connections?error=google_failed`)
  }
}
