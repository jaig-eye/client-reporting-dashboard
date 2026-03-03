import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { syncClient, BACKFILL_DAYS } from '@/lib/sync'

function isAdminAuthed(session: string | undefined) {
  return session && session === process.env.ADMIN_PASSWORD
}

/**
 * POST /api/admin/accounts/link
 *
 * Maps an ad account to a client and triggers a 730-day backfill.
 *
 * Body (one of two forms):
 *   { ad_account_id: string, client_id: string }          — link existing unlinked row by UUID
 *   { account_id: string, platform: string, client_id: string } — find or create by platform account_id
 */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { client_id } = body
  if (!client_id) return NextResponse.json({ error: 'client_id is required' }, { status: 400 })

  const db = createAdminClient()
  let accountRowId: string | undefined

  if (body.ad_account_id) {
    // Link an existing discovered account (selected from dropdown)
    const { data, error } = await db
      .from('ad_accounts')
      .update({ client_id })
      .eq('id', body.ad_account_id)
      .is('client_id', null) // safety: never reassign already-mapped accounts
      .select('id')
      .single()

    if (error || !data) {
      return NextResponse.json(
        { error: 'Account not found or already mapped to another client' },
        { status: 404 }
      )
    }
    accountRowId = data.id
  } else if (body.account_id && body.platform) {
    // Manual account ID entry — find or create the row, then map it
    const normalised = String(body.account_id).trim()
    const { data, error } = await db
      .from('ad_accounts')
      .upsert(
        { platform: body.platform, account_id: normalised, client_id },
        { onConflict: 'platform,account_id', ignoreDuplicates: false }
      )
      .select('id')
      .single()

    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Failed to link account' }, { status: 500 })
    }
    accountRowId = data.id
  } else {
    return NextResponse.json(
      { error: 'Provide either ad_account_id or account_id + platform' },
      { status: 400 }
    )
  }

  // Determine the platform of the account that was just linked
  const { data: linkedAccount } = await db
    .from('ad_accounts')
    .select('platform, access_token, refresh_token')
    .eq('id', accountRowId!)
    .single()

  const platform = linkedAccount?.platform
  const hasCredentials = !!(linkedAccount?.access_token || linkedAccount?.refresh_token)

  if (accountRowId && (platform !== 'google' || hasCredentials)) {
    // Meta: backfill via agency token (handled in syncClient)
    // Google with OAuth credentials: backfill via stored token
    // Google MCC accounts (no credentials): skip — MCC script handles it
    syncClient(client_id, BACKFILL_DAYS, accountRowId).catch(err =>
      console.error(`Backfill failed for account ${accountRowId}:`, err)
    )
  }

  return NextResponse.json({
    success: true,
    ad_account_id: accountRowId,
    backfill: platform !== 'google' || hasCredentials ? 'started' : 'run_mcc_script',
  })
}
