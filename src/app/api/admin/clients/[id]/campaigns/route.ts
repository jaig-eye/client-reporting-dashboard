// GET  /api/admin/clients/[id]/campaigns — list all campaign assignments for a client
// PATCH /api/admin/clients/[id]/campaigns — update display_mode / hidden / conversion_label
//        for a single campaign assignment identified by { source, campaign_id }

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: clientId } = await params
  const db = createAdminClient()

  const { data, error } = await db
    .from('client_campaign_assignments')
    .select('id,source,campaign_id,campaign_name,display_mode,conversion_label,hidden')
    .eq('client_id', clientId)
    .order('source')
    .order('campaign_name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ campaigns: data ?? [] })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: clientId } = await params
  const body = await request.json()
  const { source, campaign_id, display_mode, hidden, conversion_label } = body

  if (!source || !campaign_id) {
    return NextResponse.json({ error: 'source and campaign_id are required' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  if (display_mode     !== undefined) patch.display_mode     = display_mode
  if (hidden           !== undefined) patch.hidden           = hidden
  if (conversion_label !== undefined) patch.conversion_label = conversion_label

  const db = createAdminClient()

  const { data, error } = await db
    .from('client_campaign_assignments')
    .update(patch)
    .eq('client_id', clientId)
    .eq('source', source)
    .eq('campaign_id', campaign_id)
    .select('id,source,campaign_id,campaign_name,display_mode,conversion_label,hidden')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
