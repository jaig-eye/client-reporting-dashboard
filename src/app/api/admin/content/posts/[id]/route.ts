// PATCH /api/admin/content/posts/[id]
// Body: { status?, title?, seoTitle?, content?, metaDescription?, slug?,
//         targetKeyword?, suggestedTags?, featuredImageUrl?, wpStatus?, authorId?, categoryIds? }
// Status-only updates (reject, restore) and full Save Changes from the review drawer.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { recheckPostQuality } from '@/lib/content/recheckQuality'

const ALLOWED_STATUSES =['pending', 'for_review', 'approved', 'rejected', 'published', 'draft_saved']

type PatchBody = {
  status?:          string
  title?:           string | null
  seoTitle?:        string | null
  content?:         string | null
  metaDescription?: string | null
  slug?:            string | null
  targetKeyword?:   string | null
  suggestedTags?:   string[]
  featuredImageUrl?: string | null
  wpStatus?:        string | null
  authorId?:        number | null
  categoryIds?:     number[] | null
  connectionId?:    string | null
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminSession = await getAdminSession()
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()

  const { id } = await params
  const body = await request.json() as PatchBody

  if (body.status !== undefined && !ALLOWED_STATUSES.includes(body.status))
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })

  const update: Record<string, unknown> = {}

  if (body.status          !== undefined) update.status           = body.status
  if (body.title           !== undefined) update.title            = body.title
  if (body.seoTitle        !== undefined) update.seo_title        = body.seoTitle
  if (body.content         !== undefined) update.content          = body.content
  if (body.metaDescription !== undefined) update.meta_description = body.metaDescription
  if (body.slug            !== undefined) update.slug             = body.slug
  if (body.targetKeyword   !== undefined) update.target_keyword   = body.targetKeyword
  if (body.suggestedTags   !== undefined) update.suggested_tags   = body.suggestedTags
  if (body.featuredImageUrl !== undefined) update.featured_image_url = body.featuredImageUrl
  if (body.wpStatus        !== undefined) update.wp_status        = body.wpStatus
  if (body.authorId        !== undefined) update.wp_author_id     = body.authorId
  if (body.categoryIds     !== undefined) update.wp_category_ids  = body.categoryIds
  if (body.connectionId    !== undefined) update.connection_id    = body.connectionId

  if (Object.keys(update).length === 0)
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

  const db = createAdminClient()

  // Same guard as /content/status: rejecting a post that is live on a CMS here
  // would hide it from the dashboard while leaving the article published, and
  // only /dismiss knows how to ask what should happen to the live copy.
  if (body.status === 'rejected') {
    const { data: live } = await db
      .from('content_posts')
      .select('wp_post_id, bc_post_id')
      .eq('id', id)
      .maybeSingle()
    const l = live as { wp_post_id?: number | null; bc_post_id?: number | null } | null
    if (l?.wp_post_id || l?.bc_post_id) {
      return NextResponse.json(
        { error: 'This post is published on the client\'s site. Use Discard in the review view so you can choose whether to leave, unpublish, or delete the live article.' },
        { status: 409 },
      )
    }
  }

  const { error } = await db.from('content_posts').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // A content-bearing edit invalidates the quality report, and migration 206's
  // trigger clears it — correctly, since a report about the old text says nothing
  // about the new one. But the cron gate fails closed on a missing report, so
  // without recomputing it here a single typo fix would disqualify an approved
  // post from auto-publish forever, and the hold alert's own advice ("re-save it")
  // would just clear the report again. Awaited so the caller's next read sees the
  // new report rather than a transient null.
  const CONTENT_FIELDS = ['content', 'title', 'seo_title', 'meta_description', 'slug', 'featured_image_url']
  if (CONTENT_FIELDS.some(f => f in update)) {
    await recheckPostQuality(db, id)
  }

  logActivity(adminSession, 'updated', 'post', {
    resourceId: id,
    ip,
    meta: { fields: Object.keys(update) },
  })

  return NextResponse.json({ ok: true })
}
