// POST /api/admin/content/posts/[id]/approve
// Uploads an already-generated pending post to WordPress or BigCommerce as a draft.

export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { publishPost, publishPage, updatePost, updatePage, ensureTagIds, uploadMediaToWordPress, getCategories, createCategory , verifyPostMeta, fetchWithSiteCredentials, isWpPlaceholderLink, isLinkOnSite } from '@/lib/connectors/wordpress'
import { xmlrpcSetPostMeta } from '@/lib/connectors/wordpressXmlrpc'
import { rankMathUpdateMeta } from '@/lib/connectors/rankMathApi'
import { publishBCPage, updateBCPage, updateBCBlogPost, fetchBCPage, fetchBCStorefrontOrigin, bcPermalink } from '@/lib/connectors/bigcommerce'
import { logActivity }        from '@/lib/activity'
import { sendDiscordMessage }  from '@/lib/discord'
import { getNotif, type NotifConfig } from '@/lib/notificationConfig'
import { injectNearbyLinks }   from '@/lib/content/injectNearbyLinks'
import { styleTables, stripEditorialMarkers } from '@/lib/content/contentHtml'
import { isPublicPermalink }   from '@/lib/content/postLinks'
import { recordSiloLinkTasks } from '@/lib/content/siloLinkTasks'

/**
 * The Rank Math block sent with every post and page.
 *
 * One builder rather than the three identical literals this file used to carry — they had
 * already started to drift, and a field added to one copy is a field silently missing from the
 * others.
 */
function rankMathMeta(p: Record<string, unknown>): Record<string, string> {
  return {
    rank_math_title:         p.seo_title        ? String(p.seo_title)        : String(p.title ?? ''),
    rank_math_description:   p.meta_description ? String(p.meta_description) : '',
    rank_math_focus_keyword: p.target_keyword   ? String(p.target_keyword)   : '',
  }
}

/**
 * Time kept back from maxDuration for everything after the SEO-field work — writing the response
 * and the platform's own overhead. The work stops this far short of the limit.
 */
const RESPONSE_RESERVE_MS = 5_000

/**
 * Below this much time left, only Rank Math's write is attempted: no read-back and no XML-RPC
 * fallback (two requests of their own). A slow site must never turn a push that worked into a
 * timed-out request the caller reads as a failure.
 */
const FULL_META_CHECK_MIN_MS = 20_000

/** Below this, not even Rank Math's write is attempted. */
const META_WRITE_MIN_MS = 2_000

/**
 * Store the Rank Math fields, and report any that did not stick.
 *
 * The upload carries them, but Rank Math does not register its keys with show_in_rest, so
 * WordPress answers 200 and drops them: live client posts show the post title where the SEO title
 * should be. So they are written through Rank Math's own endpoint on every push — idempotent, one
 * request, and capability-checked, which an application password satisfies — with XML-RPC as the
 * fallback when that write fails. A site without Rank Math at all (its route does not exist) gets
 * neither: there is nothing there to read rank_math_* fields.
 *
 * Then it reads back what REST can see. On most sites Rank Math's keys are not readable over REST
 * at all, and an unreadable key is not a failed one: when an endpoint accepted the write, it
 * stands. Only a readable key with the wrong value, or a write nothing accepted, is reported.
 *
 * Every request is bounded by `deadline` (epoch ms): the route runs this LAST, after everything
 * that matters is recorded, and must answer before maxDuration whatever the client's site does.
 *
 * The result goes to the activity log as well as the console. A console warning is not a report:
 * it lives in Vercel logs nobody opens, which is how a year of posts went out with no SEO title
 * before anyone noticed.
 *
 * Never throws and never fails a push that already succeeded.
 */
async function reportMetaMisses(
  args: {
    postRowId: string; clientId: string; siteUrl: string
    auth: { username: string; app_password: string }
    wpId: number; expected: Record<string, string>; postType: 'posts' | 'pages'
    deadline: number
  },
): Promise<void> {
  try {
    const fields = Object.fromEntries(Object.entries(args.expected).filter(([, v]) => v))
    if (Object.keys(fields).length === 0) return

    const left = () => args.deadline - Date.now()
    const where = `${args.postType} ${args.wpId} on ${args.siteUrl}`

    if (left() < META_WRITE_MIN_MS) {
      console.warn(`[approve] SEO fields not written for ${where}: the request had no time left after the push`)
      return
    }
    const write = await rankMathUpdateMeta(args.siteUrl, args.auth, args.wpId, fields, left())
    // No Rank Math on the site: nothing to write the fields for, and nothing to report.
    if (write === 'absent') return

    let via: 'rankmath' | 'xmlrpc' | null = write === 'stored' ? 'rankmath' : null
    let stillMissing: { key: string; sent: string; stored: string; readable: boolean }[]
    /** Why the fallback did not run, when it did not. */
    let fallbackSkipped: string | null = null

    if (left() < FULL_META_CHECK_MIN_MS) {
      // No time for a read-back, or for XML-RPC's two requests. A write Rank Math accepted stands;
      // one it refused is reported as such, since nothing else could be tried.
      if (via) {
        console.log(`[approve] SEO fields written via rankmath for ${where} (read-back skipped: ${Math.round(left() / 1000)}s left)`)
        return
      }
      stillMissing = Object.entries(fields).map(([key, sent]) => ({ key, sent, stored: '', readable: false }))
      fallbackSkipped = 'not tried — the request was out of time after the push'
    } else {
      // null: nothing could be read back.
      const read = await verifyPostMeta(args.siteUrl, args.auth, args.wpId, fields, args.postType, left())
      if (via) {
        stillMissing = (read ?? []).filter(m => m.readable)
      } else {
        // Rank Math refused or could not be reached. XML-RPC, which does not consult show_in_rest,
        // for whatever the read shows missing — every field, when nothing could be read.
        const toRepair = read ?? Object.entries(fields).map(([key, sent]) => ({ key, sent, stored: '', readable: false }))
        stillMissing = toRepair
        if (toRepair.length > 0) {
          if (left() < FULL_META_CHECK_MIN_MS) {
            fallbackSkipped = 'not tried — the request was out of time after the read-back'
          } else {
            const repair = Object.fromEntries(toRepair.map(m => [m.key, m.sent]))
            if (await xmlrpcSetPostMeta(args.siteUrl, args.auth, args.wpId, repair, left() - META_WRITE_MIN_MS)) {
              via = 'xmlrpc'
              stillMissing = left() < META_WRITE_MIN_MS
                ? []
                : ((await verifyPostMeta(args.siteUrl, args.auth, args.wpId, repair, args.postType, left())) ?? [])
                    .filter(m => m.readable)
            }
          }
        }
      }
    }

    if (stillMissing.length === 0) {
      if (via) console.log(`[approve] SEO fields written via ${via} for ${where}`)
      return
    }

    const summary = stillMissing
      .map(m => `${m.key}: sent ${m.sent.length} chars, stored ${m.stored ? `"${m.stored.slice(0, 40)}"` : 'nothing'}`)
      .join('; ')
    console.warn(
      `[approve] ${stillMissing.length} SEO field(s) could not be stored for ${where}: ${summary}. ` +
      `REST drops them (Rank Math does not register its keys with show_in_rest), and ` +
      (via
        ? `${via} accepted the write without it taking effect.`
        : `Rank Math's updateMeta refused the write; XML-RPC ${fallbackSkipped ?? 'was unavailable'}.`),
    )
    logActivity(await getAdminSession(), 'seo_meta_not_stored', 'content_post', {
      resourceId: args.postRowId,
      clientId:   args.clientId || undefined,
      meta: {
        site:     args.siteUrl,
        wp_id:    args.wpId,
        wp_type:  args.postType,
        fields:   stillMissing.map(m => m.key),
        detail:   summary,
        // What was tried, so nobody re-investigates from scratch.
        rest:     'rejected — Rank Math does not register its meta keys with show_in_rest',
        repaired_via: via ?? 'nothing available',
        rankmath: via === 'rankmath' ? 'accepted the write but the value did not stick' : 'refused the write, or could not be reached',
        xmlrpc:   via === 'xmlrpc'   ? 'accepted the write but the value did not stick' : (fallbackSkipped ?? 'unavailable (xmlrpc.php disabled or blocked)'),
      },
    })
  } catch (e) {
    console.warn('[approve] SEO meta verification skipped:', e)
  }
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Everything after the push is fitted into what is left of maxDuration — see reportMetaMisses.
  const deadline = Date.now() + maxDuration * 1000 - RESPONSE_RESERVE_MS

  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Read optional flags from body:
  //   auto   — sent by the cron for auto-push (skips duplicate-push guard)
  //   action — 'approve_only' marks the post as admin-approved without pushing to WP/BC
  //             'approve_and_push' (default) pushes immediately (existing behaviour)
  let isAuto = false
  let action  = 'approve_and_push'
  try {
    const body = await request.json() as { auto?: boolean; action?: string; source?: string }
    isAuto  = body?.auto === true
    if (body?.action) action = body.action
  } catch { /* no body is fine */ }

  const { id } = await params
  const db = createAdminClient()

  // silo_id added after migration 164 (content_silos enhancements) applied to production
  const { data: post, error: postErr } = await db
    .from('content_posts')
    // wp_site_url and bc_store_hash are NOT optional here. A republish targets an
    // id that only means anything on the site it was created on, so the write has
    // to go to the site the post RECORDS, not whatever connection the client
    // happens to have active now. See the republish guards below.
    .select('id, client_id, connection_id, status, title, content, seo_title, meta_description, slug, focus_topic, target_keyword, suggested_tags, target_publish_date, wp_post_id, wp_site_url, bc_post_id, bc_store_hash, featured_image_url, content_type, city, state_abbr, service_name, service_page_url, silo_id, wp_author_id, wp_category_ids, image_alt_text, featured_image_source')
    .eq('id', id)
    .maybeSingle()

  if (postErr || !post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  const p = post as Record<string, unknown>

  // Never while a regenerate is running. full-regenerate's background job owns the row until it
  // writes the new article and sets 'for_review'; approving in between either pushes the text
  // that is about to be replaced (WordPress, BigCommerce) or records an approval of it
  // (approve_only) — and the job's save then puts a post nobody has read under that approval.
  // Checked before every path below, so approve_only, WordPress and BigCommerce all refuse.
  const GENERATING_REFUSAL = 'This post is still being regenerated — approve it once it finishes'
  if (p.status === 'generating') {
    return NextResponse.json({ error: GENERATING_REFUSAL }, { status: 409 })
  }

  // A post that is already on a CMS is UPDATED in place, not duplicated.
  //
  // This used to be a hard 400. That made "regenerate an already-live post" a
  // dead end: full-regenerate keeps the platform id, so this route refused the
  // row forever and the cron's `.is('wp_post_id', null)` filter excluded it too.
  // The regenerated content simply never reached the client's site while the
  // stale copy stayed live. See migration 200.
  const existingWpId = p.wp_post_id ? Number(p.wp_post_id) : null
  const existingBcId = p.bc_post_id ? Number(p.bc_post_id) : null
  const isRepublish  = existingWpId !== null || existingBcId !== null

  // ─── approve_only: mark as admin-approved; cron will push on schedule ──────
  if (action === 'approve_only') {
    const adminSession = await getAdminSession()
    const approvedBy   = adminSession?.email ?? (adminSession?.isSuperAdmin ? 'super_admin' : 'admin')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: approvedRows, error: updateErr } = await (db as any).from('content_posts').update({
      status:            'approved',
      admin_approved_at: new Date().toISOString(),
      admin_approved_by: approvedBy,
    }).eq('id', id)
      // The check above read the status a moment ago; a regenerate claimed since then must still
      // win. Conditional in the write itself, so there is no window between check and update.
      .neq('status', 'generating')
      .select('id')

    if (updateErr) {
      return NextResponse.json({ error: 'Failed to approve post' }, { status: 500 })
    }
    if (!approvedRows?.length) {
      return NextResponse.json({ error: GENERATING_REFUSAL }, { status: 409 })
    }

    logActivity(adminSession, 'approved', 'post', {
      resourceId: id,
      clientId:   String(p.client_id),
      meta:       { title: p.title, approved_only: true },
    })

    return NextResponse.json({ ok: true, status: 'approved' })
  }
  // ────────────────────────────────────────────────────────────────────────────

  // Resolve WP connection: prefer stored connection_id (WP only), fall back to any active WP connection
  type ConnRow = { id: string; external_id: string; connector: { auth: Record<string, unknown>; config: Record<string, unknown> } }
  let connData: ConnRow | null = null

  if (p.connection_id) {
    // Only match WP connections — if connection_id is a BC connection, let it fall through to the BC block below
    const { data } = await db
      .from('client_connections')
      .select('id, external_id, connector:connectors!inner(type, auth, config)')
      .eq('id', String(p.connection_id))
      // The connection must belong to THIS post's client. connection_id is just a column on
      // the row, settable through PATCH, so without this a post could be pushed to another
      // client's WordPress — publishing one client's article on another's site.
      .eq('client_id', String(p.client_id))
      .eq('connector.type', 'wordpress')
      .maybeSingle()
    connData = data as ConnRow | null
  }

  if (!connData) {
    const { data } = await db
      .from('client_connections')
      .select('id, external_id, connector:connectors!inner(type, auth, config)')
      .eq('client_id', String(p.client_id))
      .eq('status', 'active')
      .eq('connector.type', 'wordpress')
      .limit(1)
      .maybeSingle()
    connData = data as ConnRow | null
  }

  if (!connData) {
    // No WordPress connection — check for BigCommerce
    type BcConnRow = { id: string; connector: { auth: Record<string, unknown>; config: Record<string, unknown> } }
    let bcConnData: BcConnRow | null = null

    if (p.connection_id) {
      const { data } = await db
        .from('client_connections')
        .select('id, connector:connectors!inner(auth, config)')
        .eq('id', String(p.connection_id))
        // Same ownership check the WordPress branch above has. It was added there only, so
        // the cross-client publish it closes stayed wide open on this path — connection_id is
        // a plain column settable through PATCH, so a BigCommerce post could be pushed to
        // another client's storefront.
        .eq('client_id', String(p.client_id))
        .maybeSingle()
      bcConnData = data as BcConnRow | null
    }

    if (!bcConnData) {
      const { data } = await db
        .from('client_connections')
        .select('id, connector:connectors!inner(type, auth, config)')
        .eq('client_id', String(p.client_id))
        .eq('status', 'active')
        .eq('connector.type', 'bigcommerce')
        .limit(1)
        .maybeSingle()
      bcConnData = data as BcConnRow | null
    }

    if (!bcConnData) {
      return NextResponse.json({ error: 'No WordPress or BigCommerce connection found for this client' }, { status: 400 })
    }

    const { connector: bcConnector } = bcConnData
    const storeHash   = String(bcConnector.config.store_hash   || bcConnector.auth.store_hash   || '')
    const accessToken = String(bcConnector.config.access_token || bcConnector.auth.access_token || '')

    if (!storeHash || !accessToken) {
      return NextResponse.json({ error: 'BigCommerce credentials incomplete' }, { status: 400 })
    }

    // A republish targets bc_post_id, which is only meaningful in the store the
    // post was created in. BigCommerce ids are small sequential integers, so if
    // the client has reconnected to a different store, id 42 there is almost
    // certainly a real unrelated article — and we would silently overwrite the
    // client's own content with ours, then rewrite bc_store_hash so the original
    // could never be found again. Refuse instead; the operator can detach the
    // post (regenerate → publish as new) if the move was intentional.
    const recordedStoreHash = p.bc_store_hash ? String(p.bc_store_hash) : null
    if (existingBcId !== null && recordedStoreHash && recordedStoreHash !== storeHash) {
      return NextResponse.json(
        { error: `This post was published to BigCommerce store ${recordedStoreHash}, but the client's active connection is store ${storeHash}. Re-pushing would overwrite an unrelated article in the new store. Regenerate it as a new post instead.` },
        { status: 409 },
      )
    }

    const { data: csRowBc } = await db
      .from('content_settings')
      .select('publish_time, bc_author, blog_url_prefix')
      .eq('client_id', String(p.client_id))
      .maybeSingle()
    type CsRowBc = { publish_time?: string | null; bc_author?: string | null; blog_url_prefix?: string | null }
    const csRowBcTyped  = csRowBc as CsRowBc | null
    const bcPublishTime = csRowBcTyped?.publish_time ?? '09:00'
    // Per-post byline wins, then the client default, then 'Admin'. The reviewer typing a
    // name in the drawer is the most specific intent available.
    //
    // Fetched separately and tolerantly: bc_author_name arrives in migration 212, and naming
    // it in the main select above would fail that query outright and break publishing.
    const { data: bcRow } = await db
      .from('content_posts')
      .select('bc_author_name')
      .eq('id', id)
      .maybeSingle()
    const perPostAuthor = (bcRow as { bc_author_name?: string | null } | null)?.bc_author_name
    const bcAuthor      = perPostAuthor?.trim() || csRowBcTyped?.bc_author || 'Admin'
    const bcBlogPrefix  = (() => {
      const raw = csRowBcTyped?.blog_url_prefix?.trim()
      if (!raw) return '/blog/'
      const s = raw.startsWith('/') ? raw : `/${raw}`
      return s.endsWith('/') ? s : `${s}/`
    })()

    const publishedDate = p.target_publish_date
      ? new Date(`${String(p.target_publish_date)}T${bcPublishTime}:00`).toUTCString()
      : new Date().toUTCString()

    const slugify = (text: string) =>
      text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const postSlug = p.slug
      ? String(p.slug)
      : `/blog/${slugify(String(p.title ?? ''))}/`

    const tags = Array.isArray(p.suggested_tags) ? (p.suggested_tags as string[]) : []

    // Upload featured image to BC CDN (non-fatal)
    let thumbnailPath: string | undefined
    if (p.featured_image_url) {
      try {
        const imgRes = await fetch(String(p.featured_image_url))
        if (imgRes.ok) {
          const blob = await imgRes.blob()
          const ext  = (blob.type.split('/')[1] || 'jpg').replace(/\+.*$/, '')
          const form = new FormData()
          form.append('image_file', blob, `${slugify(String(p.title ?? 'post'))}.${ext}`)
          const uploadRes = await fetch(
            `https://api.bigcommerce.com/stores/${storeHash}/v2/content/images`,
            { method: 'POST', headers: { 'X-Auth-Token': accessToken, Accept: 'application/json' }, body: form }
          )
          if (uploadRes.ok) {
            const uploadData = (await uploadRes.json()) as Record<string, unknown>
            const cdnUrl = String(uploadData.url ?? uploadData.cdn_url ?? '')
            if (cdnUrl) thumbnailPath = cdnUrl
          }
        }
      } catch { /* non-fatal */ }
    }

    try {
      const isSaPage = p.content_type === 'service_area'

      if (isSaPage) {
        // Use BC pages API for service area pages
        const pageBody = stripEditorialMarkers(String((p as Record<string, unknown>).content ?? ''))
        const pagePath = postSlug.startsWith('/') ? postSlug : `/${postSlug}`

        let bcPageId: number
        let bcPagePath: string
        if (existingBcId !== null) {
          await updateBCPage(storeHash, accessToken, existingBcId, { body: pageBody, name: String(p.title ?? '') })
          bcPageId   = existingBcId
          bcPagePath = (await fetchBCPage(storeHash, accessToken, existingBcId))?.url ?? pagePath
        } else {
          const bcPage = await publishBCPage(storeHash, accessToken, {
            name:       String(p.title ?? ''),
            body:       pageBody,
            url:        pagePath,
            is_visible: false,
          })
          bcPageId   = bcPage.id
          bcPagePath = bcPage.url || pagePath
        }

        const bcEditUrl = `https://store-${storeHash}.mybigcommerce.com/manage/content/pages`
        // The public permalink, not the admin panel — see migration 202.
        const publicUrl = bcPermalink(await fetchBCStorefrontOrigin(storeHash, accessToken), bcPagePath)

        await db.from('content_posts').update({
          bc_post_id:        bcPageId,
          bc_store_hash:     storeHash,
          status:            'draft_saved',
          // Only overwrite when one was actually resolved — a transient /v2/store
          // failure returns null, and writing that would wipe a permalink we
          // already had, dropping the post out of link injection and "View live".
          ...(publicUrl ? { published_url: publicUrl } : {}),
          platform_edit_url: bcEditUrl,
          last_pushed_at:    new Date().toISOString(),
          admin_approved_at: new Date().toISOString(),
        }).eq('id', id)

        const adminSession = await getAdminSession()
        logActivity(adminSession, isRepublish ? 'republished' : 'approved', 'post', {
          resourceId: id, clientId: String(p.client_id),
          meta: { title: p.title, bc_page_id: bcPageId, republished: isRepublish },
        })

        // Inject nearby-city links (fire-and-forget)
        injectNearbyLinks(id, String(p.client_id), p.service_page_url ? String(p.service_page_url) : null)
          .catch(() => {})

        return NextResponse.json({ bc_post_id: bcPageId, bc_edit_url: bcEditUrl, published_url: publicUrl, republished: isRepublish })
      }

      const blogUrl = (() => {
        const raw = postSlug.replace(/^\/|\/$/g, '')
        const prefix = bcBlogPrefix.replace(/^\/|\/$/g, '')  // e.g. 'blog'
        return raw.startsWith(`${prefix}/`) || raw === prefix ? `/${raw}/` : `/${prefix}/${raw}/`
      })()
      const bcPayload: Record<string, unknown> = {
        title:            String(p.title ?? ''),
        body:             stripEditorialMarkers(styleTables(String((p as Record<string, unknown>).content ?? ''))),
        author:           bcAuthor,
        url:              blogUrl,
        is_published:     false,
        published_date:   publishedDate,
        meta_description: String((p as Record<string, unknown>).meta_description ?? ''),
        meta_keywords:    String(p.target_keyword ?? ''),
        tags,
        ...(thumbnailPath ? { thumbnail_path: thumbnailPath } : {}),
      }

      let bcPostId:   number
      let bcPostPath: string

      if (existingBcId !== null) {
        // Already live — replace the CMS copy in place, keeping the same post id
        // (and therefore the same public URL, so nothing that links to it breaks).
        const updated = await updateBCBlogPost(storeHash, accessToken, existingBcId, {
          title:            String(bcPayload.title ?? ''),
          body:             String(bcPayload.body ?? ''),
          meta_description: String(bcPayload.meta_description ?? ''),
          meta_keywords:    String(bcPayload.meta_keywords ?? ''),
          tags:             bcPayload.tags as string[] | undefined,
          ...(thumbnailPath ? { thumbnail_path: thumbnailPath } : {}),
        })
        bcPostId   = updated.id
        bcPostPath = updated.url || blogUrl
      } else {
        const bcRes = await fetch(
          `https://api.bigcommerce.com/stores/${storeHash}/v2/blog/posts`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': accessToken, 'Accept': 'application/json' },
            body: JSON.stringify(bcPayload),
          }
        )
        if (!bcRes.ok) {
          const text = await bcRes.text()
          throw new Error(bcRes.status === 401
            ? 'BigCommerce rejected the access token (401). Reconnect the integration.'
            : `BigCommerce API error ${bcRes.status}: ${text}`)
        }
        const bcPost = (await bcRes.json()) as Record<string, unknown>
        bcPostId   = Number(bcPost.id)
        bcPostPath = String(bcPost.url || blogUrl)
      }

      const bcEditUrl = `https://store-${storeHash}.mybigcommerce.com/manage/content/blog`
      // published_url must be the PUBLIC permalink: internal-link injection reads
      // it and used to emit this admin URL into client content. See migration 202.
      const publicUrl = bcPermalink(await fetchBCStorefrontOrigin(storeHash, accessToken), bcPostPath)

      await db.from('content_posts').update({
        bc_post_id:        bcPostId,
        bc_store_hash:     storeHash,
        status:            'draft_saved',
        // See above: never let a failed storefront lookup null out a good permalink.
        ...(publicUrl ? { published_url: publicUrl } : {}),
        platform_edit_url: bcEditUrl,
        last_pushed_at:    new Date().toISOString(),
        admin_approved_at: new Date().toISOString(),
      }).eq('id', id)

      const adminSession = await getAdminSession()
      logActivity(adminSession, isRepublish ? 'republished' : 'approved', 'post', {
        resourceId: id,
        clientId: String(p.client_id),
        meta: { title: p.title, bc_post_id: bcPostId, republished: isRepublish },
      })

      return NextResponse.json({ bc_post_id: bcPostId, bc_edit_url: bcEditUrl, published_url: publicUrl, republished: isRepublish })
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

  const { connector, external_id } = connData
  const siteUrl     = String(connector.config.site_url    || external_id || '')
  const username    = String(connector.config.username    || connector.auth.username    || '')
  const appPassword = String(connector.config.app_password || connector.auth.app_password || '')

  if (!siteUrl || !username || !appPassword) {
    return NextResponse.json({ error: 'WordPress credentials incomplete' }, { status: 400 })
  }

  // Same reasoning as the BigCommerce guard above: wp_post_id is only meaningful
  // on the site it was created on. A client with two active WordPress connections
  // resolves an arbitrary one through the .limit(1) fallback, and WordPress ids
  // are small sequential integers, so re-pushing would overwrite whatever real
  // article holds that id on the other site.
  const recordedSiteUrl = p.wp_site_url ? String(p.wp_site_url) : null
  const sameHost = (a: string, b: string) => {
    try { return new URL(a).host.toLowerCase() === new URL(b).host.toLowerCase() } catch { return a === b }
  }
  if (existingWpId !== null && recordedSiteUrl && !sameHost(recordedSiteUrl, siteUrl)) {
    return NextResponse.json(
      { error: `This post was published to ${recordedSiteUrl}, but the client's active WordPress connection is ${siteUrl}. Re-pushing would overwrite an unrelated post on the new site. Regenerate it as a new post instead.` },
      { status: 409 },
    )
  }

  const auth = { username, app_password: appPassword }

  // Fetch publish time and wp_publish_mode from content settings
  const { data: csRow, error: csErr } = await db
    .from('content_settings')
    .select('publish_time, wp_publish_mode, default_author_id, default_category_ids')
    .eq('client_id', String(p.client_id))
    .maybeSingle()
  // Falling through to defaults here silently publishes at 09:00 in 'scheduled_draft' mode, which
  // may be nothing like what the client configured.
  if (csErr) console.warn('[approve] cannot read publish settings, using defaults:', csErr.message)
  type CsRow = { publish_time?: string | null; wp_publish_mode?: string | null; default_author_id?: number | null; default_category_ids?: number[] | null }
  const cs             = csRow as CsRow | null
  const publishTime    = cs?.publish_time   ?? '09:00'
  const wpPublishMode  = cs?.wp_publish_mode ?? 'scheduled_draft'

  /**
   * The SEO-meta write and read-back, deferred until the very end — after the row records
   * wp_post_id, the link tasks, the set's page and the activity log.
   *
   * reportMetaMisses costs up to five WordPress round trips and runs on every push. Awaiting it
   * between publishPost() and the content_posts update put those seconds inside the window where
   * the post is LIVE but unrecorded — and this route runs under maxDuration = 60. A kill there loses
   * the id, so the next approve or auto-push publishes the article a second time on the client's
   * site. Running it before the bookkeeping risked losing that instead. It is bounded by `deadline`.
   */
  let verifyMeta: (() => Promise<void>) | null = null

  // Two posts on one date must not go out at the same minute.
  //
  // publish_time is a single value per client, which was right while a cadence window held one
  // post. With posts_per_run above 1 it put every post on that date at exactly 09:00 — they
  // compete with each other in the feed and in the index on the day they most need the
  // attention. Each post shifts by its position on the date.
  //
  // Ordered by id. The sequence is arbitrary and that is fine — what matters is that the posts on
  // a date get different times and that a post's own time never moves, because re-pushing must not
  // reschedule a live URL. A UUID key gives both; updated_at would give neither, and created_at
  // does not exist on this table.
  const STAGGER_MINUTES = 120
  let slotOffsetMinutes = 0
  if (p.target_publish_date) {
    const { data: sameDay, error: sameDayErr } = await db
      .from('content_posts')
      .select('id')
      .eq('client_id', String(p.client_id ?? ''))
      .eq('target_publish_date', String(p.target_publish_date))
      // Only posts that will actually go out hold a slot. Counting rejected, archived and
      // still-drafting rows meant a client publishing one post a day could land it at 11:00
      // because two dead rows sat ahead of it in UUID order — a stagger built for a crowded
      // date, applied to a date with nothing on it.
      .in('status', ['approved', 'for_review', 'draft_saved', 'generated', 'scheduled', 'published'])
      .order('id', { ascending: true })
    // An unreadable sibling list reads as "no siblings", so the post takes the unstaggered time.
    // Worth a line: two posts landing on the same minute is the thing the stagger exists to stop.
    if (sameDayErr) console.warn('[approve] stagger siblings unreadable, publishing unstaggered:', sameDayErr.message)
    const siblings = (sameDay ?? []) as { id: string }[]
    const position = siblings.findIndex(s => s.id === id)
    if (position > 0) slotOffsetMinutes = position * STAGGER_MINUTES
  }

  /** publish_time plus this post's stagger, clamped inside the same day. */
  const staggeredTime = (base: string): string => {
    const [h, m] = base.split(':').map(Number)
    if (!isFinite(h) || !isFinite(m)) return base
    // Never roll into the next day: a post scheduled past midnight would publish on a date the
    // calendar never planned, which is worse than two posts sharing an hour.
    const total = Math.min(h * 60 + m + slotOffsetMinutes, 23 * 60 + 59)
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }

  // Determine WP status and scheduled date from target_publish_date
  let wpPublishStatus: 'draft' | 'future' | 'publish' = 'draft'
  let wpDate: string | undefined
  if (wpPublishMode === 'draft_only') {
    // Always save as plain draft regardless of publish date
    wpPublishStatus = 'draft'
    wpDate = undefined
  } else if (p.target_publish_date) {
    wpDate = `${String(p.target_publish_date)}T${staggeredTime(publishTime)}:00`
    wpPublishStatus = new Date(wpDate) > new Date() ? 'future' : 'publish'
  }

  try {
    const tags   = Array.isArray(p.suggested_tags) ? (p.suggested_tags as string[]) : []
    const tagIds = tags.length > 0 ? await ensureTagIds(siteUrl, auth, tags) : []

    // Featured image: REFERENCE it when it already lives on this site, upload it otherwise.
    //
    // The reviewer can pick an image out of the client's own media library, in which case the
    // file is already an attachment here and copying it back would create a duplicate — which
    // is exactly what happened before this branch: their photo went into our bucket and came
    // back as a second attachment on their own site.
    //
    // The connection check is what makes the id safe to trust. Attachment ids are per-site, so
    // an id recorded against a different connection must be ignored rather than sent — it
    // would attach whatever unrelated file happens to hold that number here.
    let featuredMediaId: number | undefined

    const { data: linkRow, error: linkErr } = await db
      .from('content_posts')
      .select('wp_featured_media_id, wp_featured_media_connection_id')
      .eq('id', id)
      .maybeSingle()

    // Migration 214 carries those two columns. Until it is applied the select above fails and
    // the id can never resolve, so the absence of a link proves nothing about where the
    // picture came from — which is why the rename decision below reads the SOURCE instead.
    if (linkErr) {
      console.warn('[approve] featured media link unavailable (apply migration 214?):', linkErr.message)
    }
    const link = linkRow as {
      wp_featured_media_id?: number | null
      wp_featured_media_connection_id?: string | null
    } | null

    const linkedMediaId   = link?.wp_featured_media_id
    const linkedMediaConn = link?.wp_featured_media_connection_id

    if (linkedMediaId && linkedMediaConn && linkedMediaConn === String(p.connection_id ?? '')) {
      featuredMediaId = Number(linkedMediaId)
    } else if (p.featured_image_url) {
      try {
        // We are introducing the file to the site. USUALLY that means we generated it, and
        // naming it well is free SEO we should take.
        //
        // But not always. When the attachment id resolves, the branch above references the
        // client's existing file and this never runs. When it does NOT resolve — the id was
        // recorded against another connection, or migration 214 is not applied yet — a pick
        // from the client's own library falls through to here and gets copied back as a
        // second attachment. That duplication is bad enough; stamping OUR slug and OUR
        // seo_title onto a photograph they named themselves makes it permanent, because the
        // filename lives in the attachment URL and cannot be changed afterwards.
        //
        // So the naming is conditional on the file being ours to name. Their picture goes back
        // under whatever name it already had.
        const fromClientLibrary = String(p.featured_image_source ?? '') === 'wp_media'

        // Their own filename, not ours and not a generic one.
        //
        // Passing `undefined` here is not the same as leaving the name alone: the uploader falls
        // back to the literal 'featured', so the client's photograph came back as featured.jpg
        // titled "featured" — renamed just as thoroughly, only worse. The basename off the
        // source URL is the name they gave it.
        const originalName = (() => {
          if (!fromClientLibrary) return undefined
          try {
            const last = new URL(String(p.featured_image_url)).pathname.split('/').pop() ?? ''
            const base = decodeURIComponent(last).replace(/\.[a-z0-9]+$/i, '').trim()
            return base || undefined
          } catch {
            return undefined
          }
        })()

        if (fromClientLibrary) {
          console.warn(`[approve] post ${id}: client-library image could not be referenced by id — re-uploading as "${originalName ?? 'featured'}" without renaming`)
        }

        // alt_text is the SEO-bearing field, so the stored alt wins over the post title: the
        // title describes the ARTICLE, while alt should describe the PICTURE, and image search
        // reads the latter. Falls back to the title when nothing better was written.
        const altText = (p.image_alt_text ? String(p.image_alt_text) : '').trim()
          || (p.title ? String(p.title) : '')

        featuredMediaId = await uploadMediaToWordPress(
          siteUrl, auth,
          String(p.featured_image_url),
          {
            altText: altText || undefined,
            title:   fromClientLibrary
              ? undefined
              : (p.seo_title ? String(p.seo_title) : (p.title ? String(p.title) : undefined)),
            // The slug is already the keyword-bearing, human-readable form of this post, and
            // the filename is permanent in the attachment URL — so it is worth spending, on a
            // file we are the origin of. Their file keeps the name it arrived with.
            filenameBase: fromClientLibrary ? originalName : (p.slug ? String(p.slug) : undefined),
          },
        )
      } catch (e) {
        console.error('[approve] featured image upload failed:', e)
      }
    }

    const isServiceArea = p.content_type === 'service_area'

    let result: { id: number; link: string; title: string; status: string; date: string }

    if (isServiceArea) {
      // Service area pages go to WP Pages, not Posts
      const saSettingsRes = await db.from('service_area_settings').select('wp_publish_mode, publish_time').eq('client_id', String(p.client_id)).maybeSingle()
      const saSettings    = (saSettingsRes.data ?? {}) as Record<string, unknown>
      const saPublishMode = (saSettings.wp_publish_mode as string | null) ?? 'draft_only'
      const saPublishTime = (saSettings.publish_time    as string | null) ?? '09:00'

      let saStatus: 'draft' | 'future' | 'publish' = 'draft'
      let saDate: string | undefined
      if (isAuto || saPublishMode === 'publish') {
        // Auto-push from cron or explicit publish mode — go live immediately
        saStatus = 'publish'
      } else if (saPublishMode !== 'draft_only' && p.target_publish_date) {
        saDate   = `${String(p.target_publish_date)}T${staggeredTime(saPublishTime)}:00`
        saStatus = new Date(saDate) > new Date() ? 'future' : 'publish'
      }

      // Hierarchical slug detection by segment count — handles any depth (2-level, 3-level, base_page).
      // The slug stored on content_posts always reflects the full path (e.g. services/rv-detailing/melbourne-fl/).
      // Walk from root to leaf, scoping each WP pages lookup by the previous parent ID.
      const rawSlug = p.slug ? String(p.slug) : ''
      let wpSlug: string | undefined = rawSlug || undefined
      let wpParent: number | undefined

      const segments = rawSlug.replace(/\/$/, '').split('/').filter(Boolean)
      if (segments.length >= 2) {
        const creds = Buffer.from(`${auth.username}:${auth.app_password}`).toString('base64')
        wpSlug = segments[segments.length - 1]
        let parentId: number | undefined
        for (let i = 0; i < segments.length - 1; i++) {
          try {
            const url = `${siteUrl}/wp-json/wp/v2/pages?slug=${encodeURIComponent(segments[i])}&per_page=1${parentId ? `&parent=${parentId}` : ''}`
            const res = await fetchWithSiteCredentials(url, { headers: { Authorization: `Basic ${creds}` } })
            if (res.ok) {
              const pages = (await res.json()) as { id: number }[]
              parentId = pages[0]?.id
              if (!parentId) break  // ancestor not found — stop; publish without parent
            }
          } catch {
            break  // non-fatal — publish without parent if lookup fails
          }
        }
        wpParent = parentId
      }

      const pageMeta = rankMathMeta(p)

      result = existingWpId !== null
        // `status` is deliberately omitted, exactly as in the blog branch below:
        // saStatus defaults to 'draft', so sending it would UN-PUBLISH a live
        // service-area page every time its content was re-pushed.
        ? await updatePage(siteUrl, auth, existingWpId, {
            title:   String(p.title ?? ''),
            content: stripEditorialMarkers(styleTables(String(p.content ?? ''))),
            // `slug` omitted for the same reason as the blog branch: a republish
            // must not move a URL that already has inbound links pointing at it.
            // The Rank Math block goes with it, so a re-push also refreshes the
            // live SEO title/description rather than leaving the first version.
            meta: pageMeta,
          })
        : await publishPage(siteUrl, auth, {
        title:   String(p.title ?? ''),
        content: stripEditorialMarkers(styleTables(String(p.content ?? ''))),
        status:  saStatus,
        date:    saDate,
        slug:    wpSlug,
        parent:  wpParent,
        meta: pageMeta,
      })

      // Same read-back as the blog branch. Service-area pages push the same three fields and
      // had no check at all, so a page whose SEO title never landed looked identical to one
      // whose did.
      const pageWpId = result.id
      verifyMeta = () => reportMetaMisses({
        postRowId: id, clientId: String(p.client_id ?? ''), siteUrl, auth,
        wpId: pageWpId, expected: pageMeta, postType: 'pages', deadline,
      })
    } else {
      const authorId = p.wp_author_id
        ? Number(p.wp_author_id)
        : (cs?.default_author_id ? Number(cs.default_author_id) : undefined)

      // Prefer per-post category IDs, then client default, then auto-resolve
      let postCategoryIds: number[] | undefined
      if (Array.isArray(p.wp_category_ids) && (p.wp_category_ids as number[]).length > 0) {
        postCategoryIds = p.wp_category_ids as number[]
      } else if (Array.isArray(cs?.default_category_ids) && (cs!.default_category_ids as number[]).length > 0) {
        postCategoryIds = cs!.default_category_ids as number[]
      } else {
        // Auto-categorize: broad-match against existing WP categories; create one if none fit.
        try {
          const allCats = await getCategories(siteUrl, auth)

          // Score each category by how many of its words appear in the post's keyword/title
          const kwText = [p.target_keyword, p.title, ...((p.secondary_keywords as string[] | null) ?? [])]
            .filter(Boolean).join(' ').toLowerCase()
          const kwWords = kwText.split(/\s+/).filter(w => w.length >= 2)

          type ScoredCat = { id: number; name: string; slug: string; score: number }
          const scored: ScoredCat[] = allCats
            .filter(c => c.name.toLowerCase() !== 'uncategorized')
            .map(c => {
              const catWords = (c.name + ' ' + c.slug.replace(/-/g, ' ')).toLowerCase().split(/\s+/).filter(w => w.length >= 2)
              const score = catWords.filter(cw => kwWords.some(kw => kw.includes(cw) || cw.includes(kw))).length
              return { ...c, score }
            })
            .filter(c => c.score > 0)
            .sort((a, b) => b.score - a.score)

          if (scored.length > 0) {
            postCategoryIds = [scored[0].id]
            console.log(`[approve] Auto-categorized "${p.title}" → existing "${scored[0].name}" (score ${scored[0].score})`)
          } else {
            // No keyword match — use "Blog" as a safe theme-neutral default rather than
            // deriving from title keywords (which produces nonsensical category names like "Brush Guards Vs").
            // First check if a blog-like category already exists but wasn't scored.
            const blogCat = allCats.find(c =>
              ['blog', 'articles', 'news', 'posts'].includes(c.name.toLowerCase()) ||
              ['blog', 'articles', 'news', 'posts'].includes(c.slug?.toLowerCase() ?? '')
            )
            if (blogCat) {
              postCategoryIds = [blogCat.id]
              console.log(`[approve] Auto-categorized "${p.title}" → existing "${blogCat.name}" (default fallback)`)
            } else {
              const newCatName = 'Blog'
              const created = await createCategory(siteUrl, auth, newCatName)
              if (created) {
                postCategoryIds = [created.id]
                console.log(`[approve] Auto-categorized "${p.title}" → NEW category "Blog"`)
              } else {
                // 409: Blog category exists but wasn't in the initial fetch — refetch
                const refreshed = await getCategories(siteUrl, auth)
                const found = refreshed.find(c => c.name.toLowerCase() === 'blog')
                if (found) postCategoryIds = [found.id]
              }
            }
          }

          // Persist the resolved category so it shows correctly in review UI
          if (postCategoryIds) {
            await db.from('content_posts').update({ wp_category_ids: postCategoryIds }).eq('id', id)
          }
        } catch (e) {
          console.warn('[approve] Auto-categorize failed (non-fatal):', e)
        }
      }

      const wpMeta = rankMathMeta(p)

      result = existingWpId !== null
        // Already live — overwrite in place so the URL and any links to it survive.
        // `date` is deliberately omitted: re-pushing must not reschedule a post
        // that has already gone out.
        ? await updatePost(siteUrl, auth, existingWpId, {
            title:          String(p.title ?? ''),
            content:        stripEditorialMarkers(styleTables(String(p.content ?? ''))),
            // `slug` is deliberately omitted, for the same reason the
            // BigCommerce branch omits `url`: keeping the post id is only half of
            // "the URL survives". full-regenerate writes a brand-new slug on
            // every rewrite, so sending it renames the live permalink — every
            // inbound link, every injected sibling link and every indexed SERP
            // entry for the old URL 404s, with no redirect. The dashboard's slug
            // still updates; it just stops being pushed to a URL that is already
            // in the wild.
            tags:           tagIds.length > 0 ? tagIds : undefined,
            featured_media: featuredMediaId,
            categories:     postCategoryIds,
            meta:           wpMeta,
          })
        : await publishPost(siteUrl, auth, {
            title:          String(p.title ?? ''),
            content:        stripEditorialMarkers(styleTables(String(p.content ?? ''))),
            status:         wpPublishStatus,
            date:           wpDate,
            slug:           p.slug ? String(p.slug) : undefined,
            tags:           tagIds.length > 0 ? tagIds : undefined,
            featured_media: featuredMediaId,
            author:         authorId,
            categories:     postCategoryIds,
            meta:           wpMeta,
          })

      const postWpId = result.id
      verifyMeta = () => reportMetaMisses({
        postRowId: id, clientId: String(p.client_id ?? ''), siteUrl, auth,
        wpId: postWpId, expected: wpMeta, postType: 'posts', deadline,
      })
    }

    const wpEditUrl = isServiceArea
      ? `${siteUrl}/wp-admin/post.php?post=${result.id}&action=edit`
      : `${siteUrl}/wp-admin/post.php?post=${result.id}&action=edit`

    // Only a real permalink goes in published_url; the wp-admin fallback lives in
    // platform_edit_url so internal-link injection never emits it. And when WP returns no link at
    // all, keep whatever was already stored rather than nulling a permalink that was previously
    // correct.
    //
    // A '?p=<id>' (post) or '?page_id=<id>' (page) link is WordPress's placeholder for content that
    // isn't public yet. Storing it makes an unpublished post look published and leaves a URL that
    // will be wrong the moment it goes live, so it is not written while the post is unpublished —
    // /api/cron/wp-reconcile collects the real permalink once the post is out. Once the post IS
    // public that same shape is the real thing: a site left on plain permalinks serves '?p=123'
    // permanently, and refusing it there would leave that client with no published_url at all.
    //
    // And it must be an absolute link on the site we just pushed to. published_url becomes "View
    // live" and an internal link in other articles, so anything else would be carried into client
    // content; not storing it costs a missing link, which reconcile retries.
    const storedLink = (() => {
      if (!result.link) return null
      if (isWpPlaceholderLink(result.link) && (result.status || wpPublishStatus) !== 'publish') return null
      if (!isLinkOnSite(result.link, siteUrl)) {
        console.warn(`[approve] post ${id}: WordPress returned a link that is not an http(s) URL on ${siteUrl} — published_url not stored`)
        return null
      }
      return result.link
    })()

    // What WordPress now holds, written whatever else is happening to the row. Losing wp_post_id
    // here means the next push publishes the article a second time on the client's site.
    const { error: recordErr } = await db.from('content_posts').update({
      wp_post_id:        result.id,
      wp_site_url:       siteUrl,
      // WordPress's answer wins, always. It used to win only for republishes and service
      // areas, and a new blog post recorded wpPublishStatus — what we asked for. WordPress
      // silently downgrades a status it won't grant (an app password without publish_posts
      // becomes a draft) and answers 200 either way, so the two diverge without a trace.
      wp_status:         result.status || wpPublishStatus,
      // See storedLink above.
      ...(storedLink ? { published_url: storedLink } : {}),
      platform_edit_url: wpEditUrl,
      last_pushed_at:    new Date().toISOString(),
      admin_approved_at: new Date().toISOString(),
    }).eq('id', id)
    if (recordErr) {
      console.error(`[approve] post ${id} is on ${siteUrl} as wp ${result.id}, but recording that failed:`, recordErr.message)
    }

    // The lifecycle status, in its own write so it can step aside for a regenerate. A
    // full-regenerate that claimed the row ('generating') while this push was in flight owns it:
    // overwriting the claim lifts every guard that waits on it and lets a second regenerate start
    // alongside the first. The job sets 'for_review' when it finishes; the fields above stay.
    const { error: statusErr } = await db.from('content_posts')
      .update({ status: 'draft_saved' })
      .eq('id', id)
      .neq('status', 'generating')
    if (statusErr) console.error(`[approve] post ${id}: could not set status draft_saved:`, statusErr.message)

    // Inject nearby-city links into sibling SA pages (fire-and-forget)
    if (isServiceArea) {
      injectNearbyLinks(id, String(p.client_id), p.service_page_url ? String(p.service_page_url) : null)
        .catch(() => {})
    }

    // The address a reader can open today, or null. Link tasks and the set's page record only
    // this: a scheduled or draft post's link is WordPress's '?p=N' placeholder, which 404s for
    // visitors until the post goes out — and a person would be asked to put exactly that link on a
    // live main page. wp-reconcile records them once the real permalink exists. (A site on plain
    // permalinks never gets a pretty one, so its sets get no tasks rather than a '?p=' address.)
    const livePermalink =
      result.status === 'publish' && storedLink && !isWpPlaceholderLink(storedLink) && isPublicPermalink(storedLink)
        ? storedLink
        : null

    // A post from a set with a main page: record the links a person should add by hand — on the
    // main page, and in the set's previous post — instead of editing the live main page. This used
    // to append a "Related … Resources" list to the bottom of the hub page on WordPress, which put
    // the link where nobody chose to put it. See lib/content/siloLinkTasks.
    //
    // On every push of a live post, republishes included: a post pushed while scheduled and
    // re-pushed after it went live would otherwise never get its tasks if this ran before
    // reconcile did. recordSiloLinkTasks skips a post the set already has tasks for. Awaited — a
    // few small queries — because work left running after the response can be cut off, and a
    // lost entry is a link nobody is told to add.
    if (p.silo_id && livePermalink) {
      await recordSiloLinkTasks(db, {
        siloId:  String(p.silo_id),
        postId:  id,
        url:     livePermalink,
        title:   String(p.title ?? ''),
        keyword: p.target_keyword ? String(p.target_keyword) : null,
      }).catch(e => console.error('[approve] recording silo link tasks failed:', e))
    }

    // The set's page for this post: published, and its address once there is a live one. target_url
    // is rendered as a public link, so neither an admin URL nor a placeholder may land there; the
    // column is left alone until there is a live permalink.
    if (p.silo_id) {
      const { error: siloPageErr } = await db.from('content_silo_pages')
        .update({ status: 'published', ...(livePermalink ? { target_url: livePermalink } : {}), updated_at: new Date().toISOString() })
        .eq('content_post_id', id)
        .eq('silo_id', String(p.silo_id))
      if (siloPageErr) console.error('[approve] silo page status update failed:', siloPageErr.message)
    }

    const adminSession = await getAdminSession()
    logActivity(adminSession, 'approved', 'post', {
      resourceId: id,
      clientId: String(p.client_id),
      meta: { title: p.title, site: siteUrl, wp_post_id: result.id },
    })

    // Discord notification (fire-and-forget)
    try {
      const [{ data: agencySettings }, { data: client }] = await Promise.all([
        db.from('agency_settings').select('discord_bot_token, notification_config').single(),
        db.from('clients').select('name, discord_channel_id').eq('id', String(p.client_id)).single(),
      ])
      const botToken    = (agencySettings as { discord_bot_token?: string | null } | null)?.discord_bot_token
      const notifConfig = ((agencySettings as Record<string, unknown> | null)?.notification_config as NotifConfig | null) ?? {}
      const channelId   = (client as { discord_channel_id?: string | null } | null)?.discord_channel_id
      const clientName  = (client as { name?: string } | null)?.name ?? ''
      if (botToken && channelId && getNotif(notifConfig, 'content_post_published').client) {
        void sendDiscordMessage(
          botToken, channelId,
          `✅ Post uploaded to WordPress draft: **${String(p.title ?? '(untitled)')}**${clientName ? ` (${clientName})` : ''}`
        ).catch(() => {})
      }
    } catch { /* non-fatal */ }

    // Last, after everything that matters is recorded, and bounded by the time left: a kill from
    // here on loses a diagnostic, never the row's link to a live post, its tasks or its log line.
    if (verifyMeta) await verifyMeta().catch(() => {})

    return NextResponse.json({
      wp_post_id:    result.id,
      wp_site_url:   siteUrl,
      wp_edit_url:   wpEditUrl,
      // The DB write above deliberately keeps admin URLs out of published_url;
      // returning wpEditUrl here put one straight back into the editor's local
      // state, so the just-pushed post showed no 'View live' link until a full
      // reload. Report exactly what was stored — a link refused above must not reach "View live"
      // through the response either.
      published_url: storedLink && isPublicPermalink(storedLink) ? storedLink : null,
    })
  } catch (err) {
    // A FAILED PUSH IS NOT A FAILED APPROVAL.
    //
    // This used to return 500 and write nothing, so a post whose upload to WordPress failed —
    // a timeout, a 502 from their host, an expired application password — kept status
    // 'for_review'. Nothing recorded that a human had approved it, nothing could retry it, and
    // if the reviewer closed the tab the decision was simply lost. Client sites fail
    // intermittently; that is normal and should not cost a review.
    //
    // Recording 'approved' captures what is actually true: a person approved this, and it is
    // not on the site yet. That is exactly the state the content-topics cron's push stage
    // selects for, so it becomes the retry queue — it re-attempts within two hours, behind
    // the same quality gate, and stops as soon as the push succeeds. The stage looked dead
    // only because nothing ever wrote the status it was waiting for.
    //
    // It also makes regeneration self-healing: the cron re-pushes a live post whose DB copy is
    // newer than its CMS copy, so regenerating an approved article now reaches the site
    // without anyone re-approving it.
    //
    // Not over 'generating' either. A regenerate that claimed the row during this push owns it;
    // overwriting the claim hands the half-rewritten post to the cron's push stage and lets a
    // second regenerate start alongside the first.
    const { error: markErr } = await db
      .from('content_posts')
      .update({ status: 'approved', admin_approved_at: new Date().toISOString() })
      .eq('id', id)
      .not('status', 'in', '("published","draft_saved","generating")')
    if (markErr) {
      console.error(`[approve] push failed AND could not mark ${id} for retry:`, markErr.message)
    }

    console.error(`[approve] push failed for ${id}, queued for automatic retry:`, String(err))
    return NextResponse.json(
      {
        error: String(err),
        // The card uses this to say the work is not lost.
        queuedForRetry: !markErr,
      },
      { status: 500 },
    )
  }
}
