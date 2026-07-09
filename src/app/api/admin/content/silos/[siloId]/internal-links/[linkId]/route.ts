// PATCH /api/admin/content/silos/[siloId]/internal-links/[linkId]
// Update status (recommended→inserted/ignored/failed), anchor text, or reason.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { siloId: string; linkId: string } }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { linkId } = params
  const body = await request.json() as Partial<{
    status:      string
    anchor_text: string
    reason:      string | null
    source_url:  string | null
    target_url:  string | null
  }>

  const allowed = ['status', 'anchor_text', 'reason', 'source_url', 'target_url']
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      update[key] = (body as Record<string, unknown>)[key]
    }
  }

  const db = createAdminClient()
  const { error } = await db.from('content_silo_internal_links').update(update).eq('id', linkId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
