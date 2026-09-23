// GET /api/cron/wp-reconcile
//
// Asks WordPress what actually happened to posts we pushed.
//
// A push records what WordPress answered at that moment, which for a scheduled post is
// status 'future' and a '?p=<id>' placeholder link. Neither is true once the post goes out, and
// nothing went back to look — so production accumulated rows claiming 'future' for posts that had
// been live for two weeks, and 4 rows claiming 'publish' with no permalink at all.
//
// This closes that loop. It re-reads every post whose recorded state can no longer be right and
// writes back WordPress's answer: the real status and, once there is one, the real permalink.
//
// Two states qualify:
//   · scheduled, and the date has passed — either it published (collect the permalink) or it
//     missed its slot and is still sitting there, which is worth seeing rather than assuming.
//   · a stored '?p=' placeholder — WordPress only serves that before a post is public.
//
// Read-only against WordPress. Nothing is published, unpublished or rescheduled here; a post that
// genuinely missed its schedule is reported, not forced out, because publishing a week-late post
// silently is a decision for a person.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyCronAuth } from '@/lib/auth'
import { fetchPost } from '@/lib/connectors/wordpress'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Bound a run so a large backlog can't overrun the function timeout. */
const MAX_POSTS_PER_RUN = 200

type PostRow = {
  id: string
  client_id: string
  title: string | null
  wp_post_id: number | null
  wp_site_url: string | null
  wp_status: string | null
  published_url: string | null
  target_publish_date: string | null
  connection_id: string | null
}

const isPlaceholderLink = (url: string | null) => !!url && /[?&]p=\d+/.test(url)

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db    = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  // Candidates: anything whose recorded state cannot still be accurate.
  const { data: rows, error } = await db
    .from('content_posts')
    .select('id, client_id, title, wp_post_id, wp_site_url, wp_status, published_url, target_publish_date, connection_id')
    .not('wp_post_id', 'is', null)
    .or(`and(wp_status.eq.future,target_publish_date.lte.${today}),published_url.like.*?p=*`)
    .limit(MAX_POSTS_PER_RUN)

  if (error) {
    console.error('[cron/wp-reconcile] candidate query failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const posts = (rows ?? []) as PostRow[]
  if (posts.length === 0) return NextResponse.json({ ok: true, checked: 0, updated: 0 })

  // WordPress credentials live on the connection, so group the work by site and read each
  // connection once rather than per post.
  const connectionIds = Array.from(new Set(posts.map(p => p.connection_id).filter((c): c is string => !!c)))
  const authByConnection = new Map<string, { username: string; app_password: string }>()
  if (connectionIds.length > 0) {
    const { data: conns } = await db
      .from('client_connections')
      .select('id, auth, connector:connectors(config)')
      .in('id', connectionIds)
    type ConnRow = {
      id: string
      auth: Record<string, unknown> | null
      connector: { config: Record<string, unknown> | null } | { config: Record<string, unknown> | null }[] | null
    }
    for (const c of (conns ?? []) as ConnRow[]) {
      // Credentials sit in either place depending on how the connection was set up — the push
      // path reads config first, then auth, and this has to agree with it or a site that works
      // for publishing would silently fail to reconcile.
      const conn   = Array.isArray(c.connector) ? c.connector[0] : c.connector
      const config = conn?.config ?? {}
      const username = String(config.username     ?? c.auth?.username     ?? '')
      const appPass  = String(config.app_password ?? c.auth?.app_password ?? '')
      if (username && appPass) authByConnection.set(c.id, { username, app_password: appPass })
    }
  }

  let checked = 0, updated = 0, missedSchedule = 0, unreadable = 0

  for (const post of posts) {
    const auth    = post.connection_id ? authByConnection.get(post.connection_id) : undefined
    const siteUrl = post.wp_site_url
    if (!auth || !siteUrl || post.wp_post_id == null) { unreadable++; continue }

    try {
      checked++
      const live = await fetchPost(siteUrl, auth, post.wp_post_id)

      // Gone from WordPress. Someone deleted it there; say so rather than keep claiming it exists.
      if (!live) {
        await db.from('content_posts')
          .update({ wp_status: 'deleted', updated_at: new Date().toISOString() })
          .eq('id', post.id)
        updated++
        console.warn(`[cron/wp-reconcile] post ${post.id} (wp ${post.wp_post_id}) no longer exists on ${siteUrl}`)
        continue
      }

      const patch: Record<string, unknown> = {}
      if (live.status && live.status !== post.wp_status) patch.wp_status = live.status
      // Only a real permalink is worth storing; the placeholder is what we were trying to escape.
      if (live.link && !isPlaceholderLink(live.link) && live.link !== post.published_url) {
        patch.published_url = live.link
      }

      if (Object.keys(patch).length > 0) {
        patch.updated_at = new Date().toISOString()
        const { error: updErr } = await db.from('content_posts').update(patch).eq('id', post.id)
        if (updErr) console.error(`[cron/wp-reconcile] update failed for ${post.id}:`, updErr.message)
        else { updated++; console.log(`[cron/wp-reconcile] ${post.id}: ${JSON.stringify(patch)}`) }
      }

      // Still scheduled after its date means WordPress never ran the job — the classic missed
      // schedule. Reported, never auto-published: a post going out a week late without anyone
      // deciding to is worse than one sitting still.
      if (live.status === 'future' && post.target_publish_date && post.target_publish_date <= today) {
        missedSchedule++
        console.warn(
          `[cron/wp-reconcile] MISSED SCHEDULE — "${post.title ?? post.id}" was due ${post.target_publish_date} ` +
          `and is still 'future' on ${siteUrl} (wp ${post.wp_post_id})`,
        )
      }
    } catch (e) {
      unreadable++
      console.warn(`[cron/wp-reconcile] could not read wp ${post.wp_post_id} on ${siteUrl}:`, e)
    }
  }

  if (missedSchedule > 0) {
    console.warn(`[cron/wp-reconcile] ${missedSchedule} post(s) missed their schedule — WP-Cron may not be running on those sites`)
  }

  return NextResponse.json({ ok: true, checked, updated, missedSchedule, unreadable })
}
