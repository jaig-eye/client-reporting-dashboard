import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { upsertMetrics } from '@/lib/sync'

/**
 * POST /api/ingest/meta
 *
 * Receives campaign metrics pushed by Make/n8n or any webhook source for Meta Ads.
 * Authenticated via a pre-shared secret in the x-ingest-secret header.
 *
 * If the account_id is not yet mapped to a client, the ad_accounts row is
 * created (client_id = null) so it appears in the mapping dropdown.
 * Campaign metrics are only written once the account has a client_id.
 *
 * Body:
 * {
 *   account_id: string          // Meta ad account ID (e.g. "act_123456789")
 *   account_name?: string       // optional — stored for display in mapping UI
 *   rows: Array<{
 *     campaign_id:       string
 *     campaign_name:     string
 *     date:              string  // YYYY-MM-DD
 *     spend:             number
 *     impressions:       number
 *     clicks:            number
 *     conversions:       number
 *     conversion_value:  number
 *   }>
 * }
 *
 * Returns: { inserted: number } or { registered: true } if awaiting mapping
 */
export async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const secret = request.headers.get('x-ingest-secret')
  if (!secret || secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { account_id?: string; account_name?: string; rows?: unknown[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { account_id, account_name, rows } = body
  if (!account_id || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'account_id and rows are required' }, { status: 400 })
  }

  const db = createAdminClient()
  const withPrefix    = account_id.startsWith('act_') ? account_id : `act_${account_id}`
  const withoutPrefix = account_id.replace(/^act_/, '')

  // ── Resolve or auto-register ad_account ───────────────────────────────────
  let { data: adAccount } = await db
    .from('ad_accounts')
    .select('id, client_id, platform')
    .eq('platform', 'meta')
    .or(`account_id.eq.${withPrefix},account_id.eq.${withoutPrefix}`)
    .single()

  if (!adAccount) {
    const { data: created } = await db
      .from('ad_accounts')
      .insert({ platform: 'meta', account_id: withPrefix, account_name: account_name ?? null })
      .select('id, client_id, platform')
      .single()

    if (!created) {
      return NextResponse.json({ error: 'Failed to register account' }, { status: 500 })
    }
    adAccount = created
  }

  // ── Skip metrics write if account not yet mapped to a client ──────────────
  if (!adAccount.client_id) {
    return NextResponse.json(
      { registered: true, message: 'Account registered — map it to a client in the admin panel to activate metrics.' },
      { status: 202 }
    )
  }

  // ── Validate rows ─────────────────────────────────────────────────────────
  const validRows = (rows as Record<string, unknown>[]).filter(
    r => r.campaign_id && r.date && typeof r.spend === 'number'
  )
  if (validRows.length === 0) {
    return NextResponse.json({ error: 'No valid rows provided' }, { status: 400 })
  }

  // ── Upsert ────────────────────────────────────────────────────────────────
  await upsertMetrics(db, adAccount.client_id, adAccount, validRows as unknown as Parameters<typeof upsertMetrics>[3])

  return NextResponse.json({ inserted: validRows.length })
}
