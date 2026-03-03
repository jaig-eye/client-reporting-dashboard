import { NextRequest, NextResponse } from 'next/server'
import { exchangeGoogleCode, getAccessibleCustomers } from '@/lib/google-ads'
import { createAdminClient } from '@/lib/supabase/server'
import { syncClient, BACKFILL_DAYS } from '@/lib/sync'

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
      const { data: account } = await db
        .from('ad_accounts')
        .upsert({
          client_id: clientId,
          platform: 'google',
          account_id: customerId,
          account_name: `Google Ads ${customerId}`,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: expiresAt,
        }, { onConflict: 'client_id,platform,account_id' })
        .select('id')
        .single()

      // Backfill historical data for this specific newly-connected account.
      // Runs inline — redirect happens after. Vercel function timeout: 60s (Pro) / 10s (Hobby).
      // For Hobby plan, reduce BACKFILL_DAYS or handle via the MCC script instead.
      if (account?.id) {
        await syncClient(clientId, BACKFILL_DAYS, account.id).catch(err =>
          console.error(`Google backfill failed for account ${customerId}:`, err)
        )
      }
    }

    return NextResponse.redirect(`${appUrl}/admin/clients/${clientId}?connected=google`)
  } catch (e) {
    console.error('Google callback error:', e)
    return NextResponse.redirect(`${appUrl}/admin/clients/${clientId}?error=google_failed`)
  }
}
