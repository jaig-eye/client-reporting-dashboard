import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'

function isAdminAuthed(session: string | undefined) {
  return session && session === process.env.ADMIN_PASSWORD
}

/**
 * GET /api/admin/accounts/unlinked
 *
 * Returns all ad_accounts where client_id IS NULL, grouped by platform.
 * Used to populate the account mapping dropdowns on the client detail page.
 */
export async function GET() {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('ad_accounts')
    .select('id, platform, account_id, account_name')
    .is('client_id', null)
    .order('platform')
    .order('account_name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
