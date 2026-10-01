// PATCH /api/admin/content/silos/[siloId]/link-tasks — mark one "add this link" task done, or undo it
// Body: { url, added_at, kind?, done }. Tasks live on content_silos.pending_links; see
// lib/content/siloLinkTasks. A missing kind means 'hub', which is what entries written before
// the kind field existed were.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

type Entry = { url?: string; added_at?: string; kind?: string; done_at?: string | null } & Record<string, unknown>

export async function PATCH(
  request: NextRequest,
  { params }: { params: { siloId: string } },
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { url?: unknown; added_at?: unknown; kind?: unknown; done?: unknown }
  if (typeof body.url !== 'string' || typeof body.added_at !== 'string' || typeof body.done !== 'boolean')
    return NextResponse.json({ error: 'url, added_at and done are required' }, { status: 400 })
  const kind = typeof body.kind === 'string' ? body.kind : 'hub'

  const db = createAdminClient()
  const { data: silo, error } = await db
    .from('content_silos')
    .select('pending_links')
    .eq('id', params.siloId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!silo) return NextResponse.json({ error: 'Silo not found' }, { status: 404 })

  const entries = (Array.isArray((silo as { pending_links: unknown }).pending_links)
    ? (silo as { pending_links: Entry[] }).pending_links
    : [])
  const i = entries.findIndex(e => e.url === body.url && e.added_at === body.added_at && (e.kind ?? 'hub') === kind)
  if (i < 0) return NextResponse.json({ error: 'That link task is no longer on this set' }, { status: 404 })

  const next = entries.slice()
  next[i] = { ...entries[i], done_at: body.done ? new Date().toISOString() : null }

  // Read-modify-write. Tasks are appended only at the moment a post goes live, so losing one to a
  // concurrent append needs that to land inside this request — accepted rather than adding a
  // database function for it.
  const { error: writeErr } = await db
    .from('content_silos')
    .update({ pending_links: next })
    .eq('id', params.siloId)
  if (writeErr) return NextResponse.json({ error: writeErr.message }, { status: 500 })

  return NextResponse.json({ pending_links: next })
}
