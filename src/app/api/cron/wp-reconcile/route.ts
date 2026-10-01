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
// writes back WordPress's answer: the real status and, once the post is published, its permalink.
// Which rows qualify is spelled out at the candidate query below — in short, everything not yet
// 'publish' with a real permalink, plus recent published rows still holding a '?p=' address.
//
// A permalink is stored only for a post WordPress says is published. A scheduled or draft post's
// link is the '?p=' placeholder; a private or trashed post's link is not one a reader can open.
//
// When it stores the first live permalink for a post in a set with a main page, it records the
// links a person should add by hand (lib/content/siloLinkTasks) — the approve route skips that for
// a post that was only scheduled when it was pushed.
//
// Read-only against WordPress. Nothing is published, unpublished or rescheduled here; a post that
// genuinely missed its schedule is reported, not forced out, because publishing a week-late post
// silently is a decision for a person.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyCronAuth } from '@/lib/auth'
import { readPostState, isWpPlaceholderLink, isLinkOnSite, isSameWpSite, wpSiteHost } from '@/lib/connectors/wordpress'
import { isPublicPermalink } from '@/lib/content/postLinks'
import { recordSiloLinkTasks } from '@/lib/content/siloLinkTasks'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Bound a run so a large backlog can't overrun the function timeout. */
const MAX_POSTS_PER_RUN = 200

/**
 * No new WordPress call starts after this much of the run. maxDuration is 300s and one post can
 * cost two 15-second calls (the read, and the collection check before anything is marked gone),
 * so this leaves room to finish the call in flight and answer. Whatever is left is reported as
 * deferred and comes round again next run.
 */
const TIME_BUDGET_MS = 240_000

/**
 * How long after its last push a published row with a '?p=' / '?page_id=' address is still asked
 * about. On a site using pretty permalinks that address is a leftover — a stale placeholder from
 * the push — and WordPress's answer replaces it. On a site left on plain permalinks it IS the
 * permalink, WordPress answers with the same address, nothing is written, and the row settles; the
 * window keeps such rows from being re-read every run for ever.
 */
const PLACEHOLDER_RECHECK_DAYS = 30

/**
 * Consecutive unreadable answers from one host before the rest of its posts wait for the next run.
 * A site that is down answers every post the same way, and each answer can take the full timeout —
 * without this one dead site with twenty scheduled posts spends the whole run.
 */
const SITE_BREAKER_THRESHOLD = 3

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
  /** Every push stamps this. A write guarded on it cannot overwrite a push made after the read. */
  last_pushed_at: string | null
  /** For the link tasks recorded when a post in a set first goes live. */
  silo_id: string | null
  target_keyword: string | null
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  const db    = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)
  // A date, not a timestamp: '.' and ':' are reserved inside a PostgREST or() filter.
  const placeholderSince = new Date(startedAt - PLACEHOLDER_RECHECK_DAYS * 86_400_000).toISOString().slice(0, 10)

  // Candidates: anything whose recorded state cannot still be accurate.
  const { data: rows, error } = await db
    .from('content_posts')
    .select('id, client_id, title, wp_post_id, wp_site_url, wp_status, published_url, target_publish_date, connection_id, content_type, last_pushed_at, silo_id, target_keyword')
    .not('wp_post_id', 'is', null)
    // Any post whose recorded state could have moved on without us — not just the overdue ones.
    //
    // The narrow version asked three questions: is it scheduled and late, does it carry a '?p='
    // placeholder, does it carry a wp-admin link. That missed whole stages of the cycle. A draft
    // published by hand in WordPress stayed 'draft' here forever; production has three drafts with
    // no permalink at all, which no LIKE can match because the column is null. A post scheduled
    // for next week that someone publishes early, or deletes, was equally invisible until its date
    // passed.
    //
    // So the question is inverted: a row is settled only when it says 'publish' AND carries a
    // permalink that is not a wp-admin link. Everything else is a candidate, at any stage, except
    // rows that can never settle and would take a slot under the cap every run, forever:
    //   · 'deleted' — WordPress has nothing left to tell us.
    //   · 'trash'   — the post is in WordPress's bin; it is not coming back on its own schedule.
    //
    // 'publish' with a '?p=' / '?page_id=' link is asked about too, for PLACEHOLDER_RECHECK_DAYS
    // after its last push. That shape is the permalink on a site left on plain permalinks — and
    // there WordPress answers with the same address, nothing is written, and the row settles — but
    // on a site with pretty permalinks it is a leftover from the push (production had one on a
    // site whose other posts all carry pretty links), and WordPress's answer replaces it.
    .or(
      `wp_status.is.null,` +
      `and(wp_status.neq.publish,wp_status.neq.deleted,wp_status.neq.trash),` +
      `and(wp_status.eq.publish,or(published_url.is.null,published_url.like.*wp-admin*)),` +
      `and(wp_status.eq.publish,last_pushed_at.gte.${placeholderSince},` +
        `or(published_url.like.*?p=*,published_url.like.*&p=*,published_url.like.*page_id=*))`,
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
  //
  // EVERY path checks the site. A credential is used only when its connection's site is the host
  // the post lives on (scheme and a leading www. ignored) — the application password goes to the
  // site it belongs to and nowhere else. The old fallback lent a client's only WordPress
  // connection to any post of that client, so a post recorded against a site the client has since
  // left had the new site's password sent to the old domain — whoever holds it now.
  type Creds    = { username: string; app_password: string }
  type SiteCred = { site: string; auth: Creds }
  type Conn     = { type?: string; auth?: Record<string, unknown> | null; config?: Record<string, unknown> | null }
  const one = (c: Conn | Conn[] | null) => (Array.isArray(c) ? c[0] : c) ?? null
  /**
   * Credentials sit in either place depending on how the connection was set up — the push path
   * reads config first, then auth, and this has to agree with it or a site that works for
   * publishing would silently fail to reconcile. The site is resolved exactly as the push path
   * resolves it. null when the connection is not a usable WordPress credential.
   */
  const siteCredOf = (conn: Conn | null, externalId: string | null): SiteCred | null => {
    if (conn?.type !== 'wordpress') return null
    const config = conn.config ?? {}
    const auth   = conn.auth   ?? {}
    const username = String(config.username     ?? auth.username     ?? '')
    const appPass  = String(config.app_password ?? auth.app_password ?? '')
    const site     = String(config.site_url || externalId || '')
    return username && appPass && site ? { site, auth: { username, app_password: appPass } } : null
  }

  const connectionIds = Array.from(new Set(posts.map(p => p.connection_id).filter((c): c is string => !!c)))
  const credByConnection = new Map<string, SiteCred>()
  if (connectionIds.length > 0) {
    const { data: conns, error: connErr } = await db
      .from('client_connections')
      .select('id, external_id, connector:connectors(type, auth, config)')
      .in('id', connectionIds)
      // As on the fallback path: a paused or errored connection is not a credential source.
      .eq('status', 'active')
    // This exact query once selected a column that does not exist. It returned no rows and no
    // exception, every post counted unreadable, and the cron reported ok:true having done nothing.
    if (connErr) console.error('[cron/wp-reconcile] connection lookup failed:', connErr.message)
    // auth and config both live on the connector, not on the client_connections row.
    type ConnRow = { id: string; external_id: string | null; connector: Conn | Conn[] | null }
    for (const c of (conns ?? []) as ConnRow[]) {
      const cred = siteCredOf(one(c.connector), c.external_id)
      if (cred) credByConnection.set(c.id, cred)
    }
  }

  /** The post's own connection, if it is active, WordPress, and for the site the post lives on. */
  const viaConnection = (p: PostRow): Creds | undefined => {
    const cred = p.connection_id ? credByConnection.get(p.connection_id) : undefined
    return cred && isSameWpSite(cred.site, p.wp_site_url) ? cred.auth : undefined
  }

  // The per-client fallback, resolved once for the clients that need it — a post can have no
  // connection_id and still have published, because the push path falls back to any active
  // WordPress connection for the client.
  //
  // Keyed by client, but a client can have more than one WordPress site, so each candidate keeps
  // the site it belongs to, and only a candidate for the post's own site is ever used.
  const fallbackByClient = new Map<string, SiteCred[]>()
  const clientsNeedingFallback = Array.from(new Set(posts.filter(p => !viaConnection(p)).map(p => p.client_id)))
  if (clientsNeedingFallback.length > 0) {
    const { data: conns, error: fbErr } = await db
      .from('client_connections')
      .select('client_id, external_id, connector:connectors(type, auth, config)')
      .in('client_id', clientsNeedingFallback)
      // The push path's fallback filters the same way; a paused connection is not a credential
      // source there and must not become one here.
      .eq('status', 'active')
    if (fbErr) console.error('[cron/wp-reconcile] fallback connection lookup failed:', fbErr.message)
    type FallbackRow = { client_id: string; external_id: string | null; connector: Conn | Conn[] | null }
    for (const c of (conns ?? []) as FallbackRow[]) {
      const cred = siteCredOf(one(c.connector), c.external_id)
      if (!cred) continue
      const list = fallbackByClient.get(c.client_id) ?? []
      list.push(cred)
      fallbackByClient.set(c.client_id, list)
    }
  }

  /** Credentials for this post's own site, or undefined. Never another site's. */
  const credentialFor = (p: PostRow): Creds | undefined =>
    viaConnection(p)
    ?? (fallbackByClient.get(p.client_id) ?? []).find(c => isSameWpSite(c.site, p.wp_site_url))?.auth

  /**
   * Record what WordPress said — onto the row as it was read, and only that row.
   *
   * A push in the meantime (an approve, the content cron's retry, a republish after a regenerate)
   * stamps last_pushed_at and may set a new wp_post_id; its answer is newer than the one this run
   * is holding, and overwriting it would put back a status, a link or 'deleted' for a post that no
   * longer matches. So the write carries both as conditions and reports when it matched nothing.
   *
   * No updated_at. Migration 206's trigger discards it on bookkeeping writes anyway, and on a
   * database with 200 but not 206 an explicit stamp pushes updated_at past last_pushed_at — which
   * the editor reads as "live copy is out of date" and the cron reads as eligible for re-push.
   * Reconcile records what WordPress said; it edits nothing.
   */
  const writeIfUnchanged = async (p: PostRow, patch: Record<string, unknown>): Promise<'written' | 'moved' | 'failed'> => {
    let q = db.from('content_posts').update(patch).eq('id', p.id).eq('wp_post_id', p.wp_post_id as number)
    q = p.last_pushed_at === null ? q.is('last_pushed_at', null) : q.eq('last_pushed_at', p.last_pushed_at)
    const { data, error: updErr } = await q.select('id')
    if (updErr) {
      console.error(`[cron/wp-reconcile] update failed for ${p.id}:`, updErr.message)
      return 'failed'
    }
    if (!data?.length) {
      console.log(`[cron/wp-reconcile] ${p.id}: pushed again since it was read — left to the next run`)
      return 'moved'
    }
    return 'written'
  }

  let linkTasksRecorded = 0
  /**
   * A post in a set has just been seen live for the first time: give the set's page its address and
   * record the links a person should add (on the main page, and in the set's previous post).
   * recordSiloLinkTasks does nothing for a set without a main page, and skips a post the set
   * already has tasks for. Database only — nothing on the client's site is touched. Never throws:
   * a failure here costs a checklist entry, not the run.
   */
  const recordWentLive = async (p: PostRow, url: string): Promise<void> => {
    try {
      const { error: pageErr } = await db.from('content_silo_pages')
        .update({ target_url: url, updated_at: new Date().toISOString() })
        .eq('content_post_id', p.id)
        .eq('silo_id', p.silo_id as string)
      if (pageErr) console.error(`[cron/wp-reconcile] ${p.id}: set page address not recorded:`, pageErr.message)

      const tasks = await recordSiloLinkTasks(db, {
        siloId:  p.silo_id as string,
        postId:  p.id,
        url,
        title:   p.title ?? '',
        keyword: p.target_keyword,
      })
      if (tasks.length > 0) linkTasksRecorded += tasks.length
    } catch (e) {
      console.error(`[cron/wp-reconcile] ${p.id}: recording silo link tasks failed:`, e)
    }
  }

  let checked = 0, updated = 0, missedSchedule = 0, unreadable = 0, noCredential = 0
  let skippedBrokenSite = 0, deferred = 0, changedSinceRead = 0
  const noCredentialLogged = new Set<string>()
  /** Host → unreadable answers in a row this run. Any usable answer resets it. */
  const failuresByHost = new Map<string, number>()

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i]
    // Already known gone, or in WordPress's bin. The select excludes these; this is the belt to
    // that brace.
    if (post.wp_status === 'deleted' || post.wp_status === 'trash') continue

    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      deferred = posts.length - i
      console.warn(`[cron/wp-reconcile] time budget spent — ${deferred} post(s) left for the next run`)
      break
    }

    const siteUrl = post.wp_site_url
    const auth    = credentialFor(post)
    const host    = wpSiteHost(siteUrl)
    if (!auth || !siteUrl || !host || post.wp_post_id == null) {
      // Nothing was asked, so nothing is known about the post: counted apart from 'unreadable',
      // which means WordPress was asked and gave no usable answer.
      noCredential++
      const key = `${post.client_id} ${host ?? '(no site)'}`
      if (!noCredentialLogged.has(key)) {
        noCredentialLogged.add(key)
        console.warn(`[cron/wp-reconcile] client ${post.client_id}: no active WordPress connection for ${siteUrl ?? '(no site recorded)'} — its posts are skipped`)
      }
      continue
    }

    if ((failuresByHost.get(host) ?? 0) >= SITE_BREAKER_THRESHOLD) { skippedBrokenSite++; continue }

    try {
      checked++
      // Service-area rows hold a PAGE id; asking /posts for one returns 404, which this loop
      // would record as "deleted from WordPress" against a page that is live.
      const state = await readPostState(siteUrl, auth, post.wp_post_id, post.content_type === 'service_area' ? 'page' : 'post')

      // Anything short of an answer from a working WordPress — a parked domain, a security plugin,
      // plain permalinks, a 5xx, a timeout — says nothing about the post. The row is left alone.
      if (state.outcome === 'unreadable') {
        unreadable++
        const failures = (failuresByHost.get(host) ?? 0) + 1
        failuresByHost.set(host, failures)
        console.warn(`[cron/wp-reconcile] could not read wp ${post.wp_post_id} on ${siteUrl}: ${state.reason}`)
        if (failures === SITE_BREAKER_THRESHOLD) {
          console.warn(`[cron/wp-reconcile] ${host}: ${failures} unreadable answers in a row — its remaining posts wait for the next run`)
        }
        continue
      }
      failuresByHost.set(host, 0)

      // Gone from WordPress: its own REST API, demonstrably working, says the id does not exist.
      // Someone deleted it there; say so rather than keep claiming it exists. This is permanent —
      // deleted rows are never selected again — which is why readPostState demands both proofs.
      if (state.outcome === 'gone') {
        const w = await writeIfUnchanged(post, { wp_status: 'deleted' })
        if (w === 'moved') changedSinceRead++
        if (w === 'written') {
          updated++
          console.warn(`[cron/wp-reconcile] post ${post.id} (wp ${post.wp_post_id}) no longer exists on ${siteUrl}`)
        }
        continue
      }
      const live = state

      const patch: Record<string, unknown> = {}
      if (live.status && live.status !== post.wp_status) patch.wp_status = live.status
      // Only a PUBLISHED post's link is an address a reader can open. A scheduled or draft post's
      // is the '?p=' placeholder; a private one's needs a login; a trashed one's is the slug with
      // '__trashed' appended. None of them belongs in published_url, which becomes "View live" and
      // an internal link in other articles. On a published post a '?p=' link is the permanent URL
      // of a site on plain permalinks, and is stored — the rule approve uses.
      if (live.status === 'publish' && live.link && live.link !== post.published_url) {
        if (!isLinkOnSite(live.link, siteUrl)) {
          // A relative, non-http or off-site link must not land there either.
          console.warn(`[cron/wp-reconcile] post ${post.id}: WordPress returned a link that is not an http(s) URL on ${siteUrl} — not stored`)
        } else {
          patch.published_url = live.link
        }
      }

      if (Object.keys(patch).length > 0) {
        const w = await writeIfUnchanged(post, patch)
        if (w === 'moved') changedSinceRead++
        if (w === 'written') {
          updated++
          console.log(`[cron/wp-reconcile] ${post.id}: ${JSON.stringify(patch)}`)
          // The post's first live permalink: the moment it went out, as far as anything here can
          // tell. A post in a set with a main page gets its hand-linking tasks now — the approve
          // route records them only for a post that was already live when pushed.
          const firstLink = typeof patch.published_url === 'string' ? patch.published_url : null
          if (post.silo_id && firstLink && !isWpPlaceholderLink(firstLink) && isPublicPermalink(firstLink)) {
            await recordWentLive(post, firstLink)
          }
        }
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

  return NextResponse.json({
    ok: true, checked, updated, missedSchedule, unreadable, noCredential, linkTasksRecorded,
    // Left for the next run, not lost: a site that tripped the breaker, posts past the time
    // budget, and rows a push rewrote while this run was reading them.
    skippedBrokenSite, deferred, changedSinceRead,
  })
}
