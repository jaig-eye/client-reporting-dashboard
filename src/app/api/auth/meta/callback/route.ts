import { NextRequest, NextResponse } from 'next/server'
import { exchangeMetaCode } from '@/lib/meta-ads'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const code  = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/admin?error=meta_auth_failed`)
  }

  try {
    const { access_token } = await exchangeMetaCode(code)
    const db = createAdminClient()

    if (state === 'agency_settings') {
      // ── Agency-level OAuth ───────────────────────────────────────────────────
      // Store the token once in agency_settings so it can be used to discover
      // and sync all Business Manager ad accounts without per-client auth.
      const { data: existing } = await db.from('agency_settings').select('id').single()
      if (!existing?.id) {
        return NextResponse.redirect(`${appUrl}/admin/settings?error=settings_not_found`)
      }

      await db.from('agency_settings').update({
        meta_access_token:     access_token,
        meta_token_expires_at: new Date(Date.now() + 55 * 24 * 60 * 60 * 1000).toISOString(),
      }).eq('id', existing.id)

      return NextResponse.redirect(`${appUrl}/admin/settings?connected=meta`)

    } else {
      // ── Legacy per-client OAuth (no longer used in UI but kept for safety) ──
      const clientId = state
      if (!clientId) return NextResponse.redirect(`${appUrl}/admin?error=meta_auth_failed`)

      const { getMetaAdAccounts } = await import('@/lib/meta-ads')
      const { syncClient, BACKFILL_DAYS } = await import('@/lib/sync')
      const accounts = await getMetaAdAccounts(access_token)

      for (const account of accounts) {
        const { data: savedAccount } = await db
          .from('ad_accounts')
          .upsert({
            client_id: clientId,
            platform: 'meta',
            account_id: account.id,
            account_name: account.name,
            access_token,
            token_expires_at: new Date(Date.now() + 55 * 24 * 60 * 60 * 1000).toISOString(),
          }, { onConflict: 'platform,account_id' })
          .select('id')
          .single()

        if (savedAccount?.id) {
          await syncClient(clientId, BACKFILL_DAYS, savedAccount.id).catch(err =>
            console.error(`Meta backfill failed for account ${account.id}:`, err)
          )
        }
      }
      return NextResponse.redirect(`${appUrl}/admin/clients/${clientId}?connected=meta`)
    }
  } catch (e) {
    console.error('Meta callback error:', e)
    const base = state === 'agency_settings' ? `${appUrl}/admin/settings` : `${appUrl}/admin`
    return NextResponse.redirect(`${base}?error=meta_failed`)
  }
}
