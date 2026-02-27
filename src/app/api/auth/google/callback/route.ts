import { NextRequest, NextResponse } from 'next/server'
import { exchangeGoogleCode, getAccessibleCustomers } from '@/lib/google-ads'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const clientId = request.nextUrl.searchParams.get('state')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

  if (!code || !clientId) {
    return NextResponse.redirect(`${appUrl}/admin?error=google_auth_failed`)
  }

  try {
    const tokens = await exchangeGoogleCode(code)
    const customers = await getAccessibleCustomers(tokens.access_token)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    const db = createAdminClient()
    for (const customerId of customers) {
      await db.from('ad_accounts').upsert({
        client_id: clientId,
        platform: 'google',
        account_id: customerId,
        account_name: `Google Ads ${customerId}`,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: expiresAt,
      }, { onConflict: 'client_id,platform,account_id' })
    }

    return NextResponse.redirect(`${appUrl}/admin/clients/${clientId}?connected=google`)
  } catch (e) {
    console.error('Google callback error:', e)
    return NextResponse.redirect(`${appUrl}/admin/clients/${clientId}?error=google_failed`)
  }
}
