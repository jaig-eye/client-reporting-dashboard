import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: clientId } = await params
  const db = createAdminClient()

  const { data, error } = await db
    .from('client_connections')
    .select('id, status, config, last_synced_at, connector:connectors(type, label)')
    .eq('client_id', clientId)
    .eq('status', 'active')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Flatten connector type to the top level for easy consumption
  const connections = ((data ?? []) as unknown as {
    id: string
    status: string
    config: Record<string, unknown> | null
    last_synced_at: string | null
    connector: { type: string; label: string } | null
  }[]).map(c => ({
    id:             c.id,
    type:           c.connector?.type ?? '',
    label:          c.connector?.label ?? '',
    config:         c.config,
    last_synced_at: c.last_synced_at,
  }))

  return NextResponse.json(connections)
}
