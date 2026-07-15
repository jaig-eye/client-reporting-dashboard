// PATCH /api/admin/content/posts/[id]
// Body: { status?, title?, seoTitle?, content?, metaDescription?, slug?,
//         targetKeyword?, suggestedTags?, featuredImageUrl?, wpStatus?, authorId?, categoryIds? }
// Status-only updates (reject, restore) and full Save Changes from the review drawer.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { logActivity } from '@/lib/activity'

const ALLOWED_STATUSES = ['pending', 'for_review', 'approved', 'rejected', 'published', 'draft_saved']

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
  const { error } = await db.from('content_posts').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  logActivity(adminSession, 'updated', 'post', {
    resourceId: id,
    ip,
    meta: { fields: Object.keys(update) },
  })

  return NextResponse.json({ ok: true })
}
