import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { fetchAllBMAdAccounts } from '@/lib/meta-ads'

function isAdminAuthed(session: string | undefined) {
  return session && session === process.env.ADMIN_PASSWORD
}

/**
 * POST /api/admin/accounts/sync/meta
 *
 * Uses the stored Meta System User Token to discover all Business Manager
 * ad accounts and upsert them into ad_accounts with client_id = null.
 * Accounts already mapped to a client are NOT overwritten.
 */
export async function POST() {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const { data: settings } = await db
    .from('agency_settings')
    .select('meta_access_token')
    .single()

  if (!(settings as Record<string, unknown>)?.meta_access_token) {
    return NextResponse.json(
      { error: 'Meta not connected. Click "Connect Meta" in Settings first.' },
      { status: 400 }
    )
  }

  const accounts = await fetchAllBMAdAccounts((settings as Record<string, unknown>).meta_access_token as string)
  if (accounts.length === 0) {
    return NextResponse.json({ synced: 0 })
  }

  // Upsert accounts — onConflict (platform, account_id) — only set client_id
  // on INSERT (never overwrite an existing mapping)
  let synced = 0
  for (const account of accounts) {
    const { error } = await db.from('ad_accounts').upsert(
      {
        platform: 'meta',
        account_id: account.id,
        account_name: account.name,
        // client_id intentionally omitted — stays null on insert,
        // existing mapped rows are untouched due to ignoreDuplicates behaviour
      },
      { onConflict: 'platform,account_id', ignoreDuplicates: true }
    )
    if (!error) synced++
  }

  return NextResponse.json({ synced })
}
