// POST /api/admin/content/posts/[id]/dismiss
// Rejects a post and handles its parent topic in one of two ways:
//   ?discard=true  → topic → 'rejected' (permanent kill)
//   (default)      → topic → 'approved', post_id = null (cron re-generates)
//
// If the post is already published (wp_post_id or bc_post_id set), archives it
// instead of rejecting — the external post stays live, it just disappears from the dashboard.

import { releaseKeywordForTopic } from '@/lib/content/siloQueue'
import { applyCmsAction, isCmsAction, type CmsAction } from '@/lib/content/cmsLifecycle'
import { NextRequest, NextResponse } from 'next/server'
import { cookies }                   from 'next/headers'
import { createAdminClient }         from '@/lib/supabase/server'
import { isAdminAuthed }             from '@/lib/auth'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const discard = request.nextUrl.searchParams.get('discard') === 'true'

  // What to do with the LIVE copy, if there is one. Defaults to 'leave', which
  // is the historical behaviour — rejecting here never touched the client's site.
  // The caller sends an explicit choice only when a human picked one in the
  // dialog, so nothing is ever removed from a live site implicitly.
  const rawCms = request.nextUrl.searchParams.get('cms')
    ?? (await request.json().catch(() => ({})) as { cms?: string }).cms
  const cmsAction: CmsAction = isCmsAction(rawCms) ? rawCms : 'leave'

  const db = createAdminClient()

  // Check if the post has already been pushed to an external platform
  const { data: post } = await db
    .from('content_posts')
    .select('wp_post_id, bc_post_id')
    .eq('id', id)
    .maybeSingle()

  const isPublished = !!(post?.wp_post_id || post?.bc_post_id)

  if (isPublished) {
    // Act on the live copy FIRST, so the dashboard never reports the article as
    // removed when the CMS call actually failed. On success this also clears the
    // platform ids, which is why archived_at is written afterwards.
    const cmsResult = await applyCmsAction(db, id, cmsAction)
    if (!cmsResult.ok) {
      return NextResponse.json(
        { error: `Could not update the live article: ${cmsResult.message}` },
        { status: 502 },
      )
    }

    // Post lives on WordPress/BigCommerce — archive it in our dashboard
    const { error } = await db
      .from('content_posts')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Mark the parent topic as published so it reaches a terminal state
    // (if discard=true, kill the topic permanently instead)
    await db
      .from('content_topics')
      .update(discard
        ? { status: 'rejected' }
        : { status: 'published' }
      )
      .eq('post_id', id)

    return NextResponse.json({ ok: true, cms: cmsResult })
  }

  // Not yet published — reject and handle topic cleanup
  const { error: postErr } = await db
    .from('content_posts')
    .update({ status: 'rejected' })
    .eq('id', id)

  if (postErr) {
    return NextResponse.json({ error: postErr.message }, { status: 500 })
  }

  // Which topic owned this post — needed to put its silo keyword back on the queue.
  const { data: ownerTopic } = await db
    .from('content_topics')
    .select('id')
    .eq('post_id', id)
    .maybeSingle()

  if (discard) {
    // Permanently kill the topic so it won't regenerate
    await db
      .from('content_topics')
      .update({ status: 'rejected' })
      .eq('post_id', id)
      .not('status', 'eq', 'rejected')

    // The topic is dead, so its silo keyword goes back on the queue — otherwise
    // the term is retired forever with nothing published for it.
    //
    // Only on this branch. The `else` path below deliberately KEEPS the topic
    // alive to be regenerated, and that topic still owns the keyword; releasing
    // it here would let a second topic claim the same term and produce two
    // articles competing for one keyword.
    if (ownerTopic) {
      await releaseKeywordForTopic(db, (ownerTopic as { id: string }).id).catch(() => {})
    }
  } else {
    // Reset topic back to approved so the cron regenerates a new post
    await db
      .from('content_topics')
      .update({ status: 'approved', post_id: null })
      .eq('post_id', id)
  }

  return NextResponse.json({ ok: true })
}
