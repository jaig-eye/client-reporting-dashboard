import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'

function isAdminAuthed(session: string | undefined) {
  return session && session === process.env.ADMIN_PASSWORD
}

/**
 * DELETE /api/admin/accounts/[id]
 *
 * Permanently deletes an ad account and all associated data:
 *   - campaign_metrics rows (via ON DELETE CASCADE on the FK)
 *   - sync_logs rows referencing this account (FK has no cascade — nulled first)
 *   - the ad_accounts row itself
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const db = createAdminClient()

  // Fetch client_id before deleting so we can revalidate the right page
  const { data: account } = await db
    .from('ad_accounts')
    .select('client_id')
    .eq('id', id)
    .single()

  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  // sync_logs.ad_account_id has no CASCADE — null it out first to avoid FK violation
  await db.from('sync_logs').update({ ad_account_id: null }).eq('ad_account_id', id)

  // Delete the account row — campaign_metrics cascades automatically
  const { error } = await db.from('ad_accounts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  revalidatePath('/admin')
  if (account.client_id) revalidatePath(`/admin/clients/${account.client_id}`)

  return NextResponse.json({ success: true })
}
