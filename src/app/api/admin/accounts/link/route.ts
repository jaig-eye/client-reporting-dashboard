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
 * Maps an ad account to a client. Any existing account of the same platform
 * already mapped to this client is unmapped first (one account per platform).
 * Triggers a 730-day backfill for Meta or credentialed Google accounts.
 *
 * Body (one of two forms):
 *   { ad_account_id: string, client_id: string }                    — link by UUID (dropdown)
 *   { account_id: string, platform: string, client_id: string }     — find or create by platform ID
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
  let platform: string | undefined

  if (body.ad_account_id) {
    // Resolve platform of the account being mapped
    const { data: acct } = await db
      .from('ad_accounts')
      .select('platform')
      .eq('id', body.ad_account_id)
      .single()

    if (!acct) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    platform = acct.platform

    // Unmap any existing account of the same platform for this client
    await db
      .from('ad_accounts')
      .update({ client_id: null })
      .eq('client_id', client_id)
      .eq('platform', platform)
      .neq('id', body.ad_account_id)

    // Map the selected account (allow reassignment — previous guard removed)
    const { data, error } = await db
      .from('ad_accounts')
      .update({ client_id })
      .eq('id', body.ad_account_id)
      .select('id')
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'Failed to map account' }, { status: 500 })
    }
    accountRowId = data.id

  } else if (body.account_id && body.platform) {
    platform = body.platform
    const normalised = String(body.account_id).trim()

    // Unmap any existing account of the same platform for this client
    await db
      .from('ad_accounts')
      .update({ client_id: null })
      .eq('client_id', client_id)
      .eq('platform', platform)

    // Find or create the row, then map it
    const { data, error } = await db
      .from('ad_accounts')
      .upsert(
        { platform, account_id: normalised, client_id },
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

  // Determine credentials to decide backfill strategy
  const { data: linkedAccount } = await db
    .from('ad_accounts')
    .select('platform, access_token, refresh_token')
    .eq('id', accountRowId!)
    .single()

  const resolvedPlatform = linkedAccount?.platform ?? platform
  const hasCredentials = !!(linkedAccount?.access_token || linkedAccount?.refresh_token)

  if (accountRowId && (resolvedPlatform !== 'google' || hasCredentials)) {
    syncClient(client_id, BACKFILL_DAYS, accountRowId).catch(err =>
      console.error(`Backfill failed for account ${accountRowId}:`, err)
    )
  }

  return NextResponse.json({
    success: true,
    ad_account_id: accountRowId,
    backfill: resolvedPlatform !== 'google' || hasCredentials ? 'started' : 'run_mcc_script',
  })
}
