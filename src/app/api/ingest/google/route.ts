import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { upsertMetrics } from '@/lib/sync'

/**
 * POST /api/ingest/google
 *
 * Receives campaign metrics pushed by the Google Ads MCC Script.
 * Authenticated via a pre-shared secret in the x-ingest-secret header.
 *
 * Body:
 * {
 *   account_id: string          // Google Ads customer ID (digits only, no dashes)
 *   rows: Array<{
 *     campaign_id:       string
 *     campaign_name:     string
 *     date:              string  // YYYY-MM-DD
 *     spend:             number  // USD, not micros
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
  // The MCC script sends the raw Google customer ID (digits only). We match
  // against both the dashed and un-dashed forms stored in ad_accounts.
  const db = createAdminClient()
  const normalised = account_id.replace(/-/g, '')

  const { data: adAccount } = await db
    .from('ad_accounts')
    .select('id, client_id, platform')
    .eq('platform', 'google')
    .or(`account_id.eq.${account_id},account_id.eq.${normalised}`)
    .single()

  if (!adAccount) {
    return NextResponse.json(
      { error: `No Google ad account found for account_id: ${account_id}` },
      { status: 404 }
    )
  }

  // ── Validate & normalise rows ─────────────────────────────────────────────
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
