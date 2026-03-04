import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'

/**
 * GET /api/admin/backfill/status
 *
 * Returns all ad accounts that are mapped to clients, annotated with whether
 * they already have campaign metrics data (row_count > 0 = skip during backfill).
 *
 * Used by the AgencyBackfill component to skip already-synced accounts and
 * avoid duplicate data pulls.
 */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')?.value
  if (!session || session !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  // All mapped accounts
  const { data: accounts } = await db
    .from('ad_accounts')
    .select('id, platform, account_id, account_name, client_id')
    .not('client_id', 'is', null)
    .order('platform')
    .order('account_name')

  if (!accounts?.length) return NextResponse.json({ accounts: [] })

  // Client names
  const clientIds = Array.from(new Set(accounts.map(a => a.client_id as string)))
  const { data: clients } = await db
    .from('clients')
    .select('id, name')
    .in('id', clientIds)
  const clientMap = new Map(clients?.map(c => [c.id, c.name]) ?? [])

  // Check which accounts have any rows in campaign_metrics (one HEAD query per account,
  // run in parallel — fast for the typical 5-30 accounts an agency manages)
  const accountIds = accounts.map(a => a.id)
  const accountsWithData = new Set<string>()
  await Promise.all(
    accountIds.map(async (id) => {
      const { count } = await db
        .from('campaign_metrics')
        .select('ad_account_id', { count: 'exact', head: true })
        .eq('ad_account_id', id)
      if (count && count > 0) accountsWithData.add(id)
    })
  )

  return NextResponse.json({
    accounts: accounts.map(a => ({
      id: a.id,
      client_id: a.client_id as string,
      client_name: clientMap.get(a.client_id as string) ?? '',
      platform: a.platform,
      account_id: a.account_id,
      account_name: (a.account_name as string | null) ?? null,
      // row_count > 0 means data exists — backfill will skip this account
      row_count: accountsWithData.has(a.id) ? 1 : 0,
    })),
  })
}
