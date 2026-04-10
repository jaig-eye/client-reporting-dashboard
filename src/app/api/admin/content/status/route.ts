import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed }     from '@/lib/auth'

/**
 * POST /api/admin/content/status
 * Body: { post_id, status }
 * Updates the status of a content_post.
 */
export async function POST(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { post_id, status } = body as { post_id: string; status: string }

  if (!post_id || !status) {
    return NextResponse.json({ error: 'Missing post_id or status' }, { status: 400 })
  }

  const allowed = ['pending', 'approved', 'rejected', 'published', 'draft_saved']
  if (!allowed.includes(status)) {
    return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 })
  }

  const db = createAdminClient()

  const updateFields: Record<string, unknown> = { status }
  if (status === 'approved' || status === 'rejected') {
    updateFields.reviewed_at = new Date().toISOString()
  }
  if (status === 'published') {
    updateFields.published_at = new Date().toISOString()
  }

  const { error } = await db
    .from('content_posts')
    .update(updateFields)
    .eq('id', post_id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
