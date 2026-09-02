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

  // Rejecting a LIVE post through this route would flip it to 'rejected' and
  // remove it from every view while the article stayed published on the client's
  // site — with nothing left in the UI able to reach it. That is exactly the
  // orphaned-content state cmsLifecycle exists to prevent, and only /dismiss is
  // wired to it. Refuse here and point at the flow that asks what should happen
  // to the live copy.
  if (status === 'rejected') {
    const { data: live } = await db
      .from('content_posts')
      .select('wp_post_id, bc_post_id')
      .eq('id', post_id)
      .maybeSingle()
    const l = live as { wp_post_id?: number | null; bc_post_id?: number | null } | null
    if (l?.wp_post_id || l?.bc_post_id) {
      return NextResponse.json(
        { error: 'This post is published on the client\'s site. Use Discard in the review view so you can choose whether to leave, unpublish, or delete the live article.' },
        { status: 409 },
      )
    }
  }

  const updateFields: Record<string, unknown> = { status }
  if (status === 'approved' || status === 'rejected') {
    updateFields.reviewed_at = new Date().toISOString()
  }
  if (status === 'published') {
    updateFields.published_at = new Date().toISOString()
  }

  const { data: postRow, error } = await db
    .from('content_posts')
    .update(updateFields)
    .eq('id', post_id)
    .select('content_type')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // When a SA post is rejected, reset the parent topic so it can be regenerated.
  if (status === 'rejected' && (postRow as { content_type?: string } | null)?.content_type === 'service_area') {
    await db
      .from('content_topics')
      .update({ status: 'approved', post_id: null, generation_error: null })
      .eq('post_id', post_id)
      .eq('content_type', 'service_area')
  }

  return NextResponse.json({ ok: true })
}
