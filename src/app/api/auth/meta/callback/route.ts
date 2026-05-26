import { NextRequest, NextResponse } from 'next/server'
import { exchangeMetaCode, metaAdsConnector } from '@/lib/connectors/meta-ads'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const code   = request.nextUrl.searchParams.get('code')
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin).replace(/\/$/, '')

  if (!code) {
    return NextResponse.redirect(`${appUrl}/admin/connections?error=meta_auth_failed`)
  }

  try {
    const redirectUri    = `${appUrl}/api/auth/meta/callback`
    const { access_token } = await exchangeMetaCode(code, redirectUri)

    const auth = { access_token }
    const db   = createAdminClient()

    // Preserve existing config (e.g. Business Manager ID) when re-authorizing
    const { data: existing } = await db
      .from('connectors')
      .select('id, config')
      .eq('type', 'meta_ads')
      .maybeSingle()

    // Explicit update-or-insert — onConflict: 'type' doesn't work with partial unique indexes
    let connector: { id: string } | null = null
    let connError: unknown = null

    if (existing?.id) {
      const { data, error } = await db
        .from('connectors')
        .update({ auth, config: existing.config ?? {}, status: 'active' })
        .eq('id', existing.id)
        .select('id')
        .single()
      connector = data; connError = error
    } else {
      const { data, error } = await db
        .from('connectors')
        .insert({ type: 'meta_ads', label: 'Meta Ads', auth, config: {}, status: 'active' })
        .select('id')
        .single()
      connector = data; connError = error
    }

    if (connError || !connector) {
      console.error('Meta connector save failed:', connError)
      return NextResponse.redirect(`${appUrl}/admin/connections?error=meta_save_failed`)
    }

    // Discover accessible ad accounts and cache them
    try {
      const accounts = await metaAdsConnector.discoverAccounts(auth, {})
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
      console.warn('Meta account discovery failed (non-fatal):', e)
    }

    return NextResponse.redirect(`${appUrl}/admin/connections/${connector.id}?connected=meta`)
  } catch (e) {
    console.error('Meta callback error:', e)
    return NextResponse.redirect(`${appUrl}/admin/connections?error=meta_failed`)
  }
}
