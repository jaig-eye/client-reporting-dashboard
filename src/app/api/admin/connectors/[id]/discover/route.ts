// POST /api/admin/connectors/[id]/discover
// Re-runs account discovery for a connector and upserts results into connector_accounts.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { googleAdsConnector } from '@/lib/connectors/google-ads'
import { metaAdsConnector } from '@/lib/connectors/meta-ads'
import { googleAnalyticsConnector }       from '@/lib/connectors/google-analytics'
import { googleSearchConsoleConnector }   from '@/lib/connectors/google-search-console'
import { googleBusinessProfileConnector } from '@/lib/connectors/google-business-profile'
import type { Connector } from '@/lib/types'

function requireAdmin(req: NextRequest): boolean {
  const session = req.cookies.get('admin_session')?.value
  return !!session && session === process.env.ADMIN_PASSWORD
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const db = createAdminClient()

  const { data, error } = await db.from('connectors').select('*').eq('id', id).single()
  if (error || !data) return NextResponse.json({ error: 'Connector not found' }, { status: 404 })

  const connector = data as Connector
  const auth   = (connector.auth   ?? {}) as Record<string, unknown>
  const config = (connector.config ?? {}) as Record<string, unknown>

  // Debug: log what we have (redact token values)
  console.log('discover: connector type:', connector.type)
  console.log('discover: auth keys:', Object.keys(auth))
  console.log('discover: config keys:', Object.keys(config))
  console.log('discover: has developer_token:', !!auth.developer_token)
  console.log('discover: has GOOGLE_DEVELOPER_TOKEN env:', !!process.env.GOOGLE_DEVELOPER_TOKEN)

  const adapter = connector.type === 'google_ads'              ? googleAdsConnector
                : connector.type === 'meta_ads'                ? metaAdsConnector
                : connector.type === 'google_analytics'        ? googleAnalyticsConnector
                : connector.type === 'google_search_console'   ? googleSearchConsoleConnector
                : connector.type === 'google_business_profile' ? googleBusinessProfileConnector
                : null

  if (!adapter) return NextResponse.json({ error: 'No adapter for this connector type' }, { status: 400 })

  try {
    const accounts = await adapter.discoverAccounts(auth, config)

    if (accounts.length > 0) {
      await db.from('connector_accounts').upsert(
        accounts.map(a => ({
          connector_id:  id,
          external_id:   a.external_id,
          external_name: a.external_name,
          metadata:      a.metadata ?? null,
        })),
        { onConflict: 'connector_id,external_id', ignoreDuplicates: false }
      )
    }

    return NextResponse.json({ count: accounts.length, accounts })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
