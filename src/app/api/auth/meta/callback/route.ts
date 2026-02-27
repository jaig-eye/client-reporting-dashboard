import { NextRequest, NextResponse } from 'next/server'
import { exchangeMetaCode, getMetaAdAccounts } from '@/lib/meta-ads'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const clientId = request.nextUrl.searchParams.get('state')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

  if (!code || !clientId) {
    return NextResponse.redirect(`${appUrl}/admin?error=meta_auth_failed`)
  }

  try {
    const { access_token } = await exchangeMetaCode(code)
    const accounts = await getMetaAdAccounts(access_token)
    const db = createAdminClient()

    for (const account of accounts) {
      await db.from('ad_accounts').upsert({
        client_id: clientId,
        platform: 'meta',
        account_id: account.id,
        account_name: account.name,
        access_token,
        token_expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      }, { onConflict: 'client_id,platform,account_id' })
    }

    return NextResponse.redirect(`${appUrl}/admin/clients/${clientId}?connected=meta`)
  } catch (e) {
    console.error('Meta callback error:', e)
    return NextResponse.redirect(`${appUrl}/admin/clients/${clientId}?error=meta_failed`)
  }
}
