import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { upsertMetrics } from '@/lib/sync'

/**
 * POST /api/ingest/meta
 *
 * Receives campaign metrics pushed by Make/n8n or any webhook source for Meta Ads.
 * Authenticated via a pre-shared secret in the x-ingest-secret header.
 *
 * Body:
 * {
 *   account_id: string          // Meta ad account ID (e.g. "act_123456789")
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
 * Returns: { inserted: number }
 */
export async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const secret = request.headers.get('x-ingest-secret')
  if (!secret || secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { account_id?: string; rows?: unknown[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { account_id, rows } = body
  if (!account_id || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'account_id and rows are required' }, { status: 400 })
  }

  // ── Resolve ad_account ────────────────────────────────────────────────────
  // Meta account IDs may be stored with or without the "act_" prefix
  const db = createAdminClient()
  const withPrefix = account_id.startsWith('act_') ? account_id : `act_${account_id}`
  const withoutPrefix = account_id.replace(/^act_/, '')

  const { data: adAccount } = await db
    .from('ad_accounts')
    .select('id, client_id, platform')
    .eq('platform', 'meta')
    .or(`account_id.eq.${withPrefix},account_id.eq.${withoutPrefix}`)
    .single()

  if (!adAccount) {
    return NextResponse.json(
      { error: `No Meta ad account found for account_id: ${account_id}` },
      { status: 404 }
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
  await upsertMetrics(db, adAccount.client_id, adAccount, validRows as Parameters<typeof upsertMetrics>[3])

  return NextResponse.json({ inserted: validRows.length })
}
