// POST /api/admin/connectors/[id]/test
// Tests the connector's connection and updates its status.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { ahrefsConnector } from '@/lib/connectors/ahrefs'

function requireAdmin(req: NextRequest): boolean {
  const session = req.cookies.get('admin_session')?.value
  return !!session && session === process.env.ADMIN_PASSWORD
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const db = createAdminClient()
  const { data: connector, error: fetchErr } = await db
    .from('connectors')
    .select('id, type, auth, config')
    .eq('id', id)
    .single()

  if (fetchErr || !connector) {
    return NextResponse.json({ error: 'Connector not found' }, { status: 404 })
  }

  const auth   = (connector.auth   ?? {}) as Record<string, unknown>
  const config = (connector.config ?? {}) as Record<string, unknown>

  if (connector.type !== 'ahrefs') {
    return NextResponse.json({ error: 'Test not supported for this connector type' }, { status: 400 })
  }

  try {
    const ok = await ahrefsConnector.testConnection!(auth, config)
    const status = ok ? 'active' : 'error'
    const updatedConfig = ok
      ? { ...config, error: undefined }
      : { ...config, error: 'API key invalid or request failed' }

    await db.from('connectors').update({
      status,
      config: updatedConfig,
      last_checked_at: new Date().toISOString(),
    }).eq('id', id)

    return NextResponse.json({ ok, status })
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'Test failed'
    await db.from('connectors').update({
      status: 'error',
      config: { ...config, error: errMsg },
      last_checked_at: new Date().toISOString(),
    }).eq('id', id)
    return NextResponse.json({ ok: false, status: 'error', error: errMsg })
  }
}
