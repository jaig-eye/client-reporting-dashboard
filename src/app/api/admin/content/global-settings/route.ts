import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed }     from '@/lib/auth'

/**
 * GET /api/admin/content/global-settings
 * Returns the global content_settings row (client_id IS NULL).
 *
 * PUT /api/admin/content/global-settings
 * Upserts the global content_settings row.
 */

export async function GET(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const { data } = await db
    .from('content_settings')
    .select('post_structure, auto_generate, posts_per_run')
    .is('client_id', null)
    .maybeSingle()

  return NextResponse.json(data ?? {})
}

export async function PUT(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { post_structure } = body as { post_structure?: string }

  const db = createAdminClient()

  // Upsert global row (client_id IS NULL)
  const { error } = await db
    .from('content_settings')
    .upsert(
      { client_id: null, post_structure: post_structure ?? null, updated_at: new Date().toISOString() },
      { onConflict: 'client_id', ignoreDuplicates: false }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
