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
//   · a stored wp-admin URL — an editor link that predates the split between published_url and
//     platform_edit_url. Current code cannot write one, but rows carrying one are still out there,
//     and internal-link injection reads published_url: left alone, a client article can end up
//     linking readers to a login screen.
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
  /** 'service_area' rows hold a WordPress PAGE id; everything else holds a post id. */
  content_type: string | null
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
    .select('id, client_id, title, wp_post_id, wp_site_url, wp_status, published_url, target_publish_date, connection_id, content_type')
    .not('wp_post_id', 'is', null)
    // LIKE cannot express the '&p=' form, so this is fractionally narrower than
    // isPlaceholderLink below. That is the safe direction: a candidate missed costs a stale row,
    // a candidate wrongly matched costs a write. WordPress emits '?p=' anyway — it is the first
    // query parameter — so the two agree in practice.
    .or(
      `and(wp_status.eq.future,target_publish_date.lte.${today}),` +
      `published_url.like.*?p=*,` +
      `published_url.like.*wp-admin*`,
    )
    // Overdue first. Without an order, PostgREST hands back an arbitrary slice of the
    // candidates, and a row that can never be fixed — a '?p=' placeholder on a post WordPress
    // still holds as a draft — matches every run and could crowd out the 'future and overdue'
    // posts this cron exists for. The cap is far above today's volume, but the order makes the
    // important case first regardless.
    .order('target_publish_date', { ascending: true, nullsFirst: false })
    .limit(MAX_POSTS_PER_RUN)

  if (error) {
    console.error('[cron/wp-reconcile] candidate query failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const posts = (rows ?? []) as PostRow[]
  if (posts.length === 0) return NextResponse.json({ ok: true, checked: 0, updated: 0 })

  // WordPress credentials live on the connection, so group the work by site and read each
  // connection once rather than per post.
  //
  // A post can have no connection_id and still have published: the push path prefers the stored
  // one and falls back to any active WordPress connection for the client. Reconcile has to follow
  // the same rule or it silently skips the posts that took the fallback — which is most of the
  // ones it exists to fix.
  const connectionIds = Array.from(new Set(posts.map(p => p.connection_id).filter((c): c is string => !!c)))
  const authByConnection = new Map<string, { username: string; app_password: string }>()
  if (connectionIds.length > 0) {
    const { data: conns, error: connErr } = await db
      .from('client_connections')
      .select('id, connector:connectors(auth, config)')
      .in('id', connectionIds)
    // This exact query once selected a column that does not exist. It returned no rows and no
    // exception, every post counted unreadable, and the cron reported ok:true having done nothing.
    if (connErr) console.error('[cron/wp-reconcile] connection lookup failed:', connErr.message)
    // auth and config both live on the connector, not on the client_connections row.
    type Conn = { auth?: Record<string, unknown> | null; config?: Record<string, unknown> | null }
    type ConnRow = { id: string; connector: Conn | Conn[] | null }
    for (const c of (conns ?? []) as ConnRow[]) {
      // Credentials sit in either place depending on how the connection was set up — the push
      // path reads config first, then auth, and this has to agree with it or a site that works
      // for publishing would silently fail to reconcile.
      const conn   = Array.isArray(c.connector) ? c.connector[0] : c.connector
      const config = conn?.config ?? {}
      const auth   = conn?.auth   ?? {}
      const username = String(config.username     ?? auth.username     ?? '')
      const appPass  = String(config.app_password ?? auth.app_password ?? '')
      if (username && appPass) authByConnection.set(c.id, { username, app_password: appPass })
    }
  }

  // The per-client fallback, resolved once for the clients that need it.
  //
  // Keyed by client, but a client can have more than one WordPress site, so each candidate keeps
  // the site it belongs to. Borrowing the other site's credentials fails the read and counts the
  // post unreadable — silently reopening the gap this fallback was added to close.
  const fallbackByClient = new Map<string, Array<{ site: string; auth: { username: string; app_password: string } }>>()
  const clientsNeedingFallback = Array.from(new Set(
    posts.filter(p => !p.connection_id || !authByConnection.has(p.connection_id)).map(p => p.client_id),
  ))
  if (clientsNeedingFallback.length > 0) {
    const { data: conns, error: fbErr } = await db
      .from('client_connections')
      .select('client_id, external_id, connector:connectors(type, auth, config)')
      .in('client_id', clientsNeedingFallback)
      // The push path's fallback filters the same way; a paused connection is not a credential
      // source there and must not become one here.
      .eq('status', 'active')
    if (fbErr) console.error('[cron/wp-reconcile] fallback connection lookup failed:', fbErr.message)
    type FallbackConn = { type?: string; auth?: Record<string, unknown> | null; config?: Record<string, unknown> | null }
    type FallbackRow = {
      client_id: string
      external_id: string | null
      connector: FallbackConn | FallbackConn[] | null
    }
    for (const c of (conns ?? []) as FallbackRow[]) {
      const conn = Array.isArray(c.connector) ? c.connector[0] : c.connector
      if (conn?.type !== 'wordpress') continue
      const config   = conn.config ?? {}
      const connAuth = conn.auth   ?? {}
      const username = String(config.username     ?? connAuth.username     ?? '')
      const appPass  = String(config.app_password ?? connAuth.app_password ?? '')
      if (!username || !appPass) continue
      // Site resolved exactly as the push path resolves it.
      const site = String(config.site_url ?? c.external_id ?? '')
      const list = fallbackByClient.get(c.client_id) ?? []
      list.push({ site, auth: { username, app_password: appPass } })
      fallbackByClient.set(c.client_id, list)
    }
  }

  /** Compare sites the way a human would: protocol, case and trailing slash carry no meaning. */
  const sameSite = (a: string, b: string) => {
    const norm = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')
    return !!a && !!b && norm(a) === norm(b)
  }

  let checked = 0, updated = 0, missedSchedule = 0, unreadable = 0

  for (const post of posts) {
    const candidates = fallbackByClient.get(post.client_id) ?? []
    const auth    = (post.connection_id ? authByConnection.get(post.connection_id) : undefined)
                 // Prefer the connection for the site this post actually lives on; only fall back
                 // to the client's single WordPress connection when there is no better match.
                 ?? candidates.find(c => sameSite(c.site, post.wp_site_url ?? ''))?.auth
                 ?? (candidates.length === 1 ? candidates[0].auth : undefined)
    const siteUrl = post.wp_site_url
    if (!auth || !siteUrl || post.wp_post_id == null) { unreadable++; continue }

    try {
      checked++
      // Service-area rows hold a PAGE id; asking /posts for one returns 404, which this loop
      // would record as "deleted from WordPress" against a page that is live.
      const live = await fetchPost(siteUrl, auth, post.wp_post_id, post.content_type === 'service_area' ? 'page' : 'post')

      // Gone from WordPress. Someone deleted it there; say so rather than keep claiming it exists.
      if (!live) {
        await db.from('content_posts')
          // No updated_at. Migration 206's trigger discards it on bookkeeping writes anyway, and
          // on a database with 200 but not 206 an explicit stamp pushes updated_at past
          // last_pushed_at — which the editor reads as "live copy is out of date" and the cron
          // reads as eligible for re-push. Reconcile records what WordPress said; it edits nothing.
          .update({ wp_status: 'deleted' })
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
        const { error: updErr } = await db.from('content_posts').update(patch).eq('id', post.id)
        if (updErr) console.error(`[cron/wp-reconcile] update failed for ${post.id}:`, updErr.message)
        else { updated++; console.log(`[cron/wp-reconcile] ${post.id}: ${JSON.stringify(patch)}`) }
      }

      // Still scheduled after its date means WordPress never ran the job — the classic missed
      // schedule. Reported, never auto-published: a post going out a week late without anyone
      // deciding to is worse than one sitting still.
      // Strictly BEFORE today. Comparing dates with <= called every post still 'future' on the
      // morning of its own publish day a missed schedule — and all day for staggered siblings
      // whose slot had not come round yet.
      if (live.status === 'future' && post.target_publish_date && post.target_publish_date < today) {
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
