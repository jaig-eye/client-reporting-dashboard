// /api/admin/connections
// POST: create a new client_connection (assign an account to a client).

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

function requireAdmin(req: NextRequest): boolean {
  const session = req.cookies.get('admin_session')?.value
  return !!session && session === process.env.ADMIN_PASSWORD
}

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { client_id, connector_id, external_id, external_name } = body

  if (!client_id || !connector_id || !external_id) {
    return NextResponse.json({ error: 'client_id, connector_id, and external_id are required' }, { status: 400 })
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('client_connections')
    .insert({
      client_id,
      connector_id,
      external_id: String(external_id).trim(),
      external_name: external_name ?? null,
      status: 'active',
    })
    .select('id, client_id, connector_id, external_id, external_name, status')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
