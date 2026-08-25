// POST /api/admin/content/posts/[id]/approve
// Uploads an already-generated pending post to WordPress or BigCommerce as a draft.

export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { publishPost, publishPage, updatePost, updatePage, ensureTagIds, uploadMediaToWordPress, getCategories, createCategory } from '@/lib/connectors/wordpress'
import { publishBCPage, updateBCPage, updateBCBlogPost, fetchBCPage, fetchBCStorefrontOrigin, bcPermalink } from '@/lib/connectors/bigcommerce'
import { logActivity }        from '@/lib/activity'
import { sendDiscordMessage }  from '@/lib/discord'
import { getNotif, type NotifConfig } from '@/lib/notificationConfig'
import { injectNearbyLinks }   from '@/lib/content/injectNearbyLinks'
import { styleTables }          from '@/lib/content/contentHtml'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    .select('id, client_id, connection_id, title, content, seo_title, meta_description, slug, focus_topic, target_keyword, suggested_tags, target_publish_date, wp_post_id, bc_post_id, featured_image_url, content_type, city, state_abbr, service_name, service_page_url, silo_id, wp_author_id, wp_category_ids')
    .eq('id', id)
    .maybeSingle()

  if (postErr || !post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  const p = post as Record<string, unknown>

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
    const { error: updateErr } = await (db as any).from('content_posts').update({
      status:            'approved',
      admin_approved_at: new Date().toISOString(),
      admin_approved_by: approvedBy,
    }).eq('id', id)

    if (updateErr) {
      return NextResponse.json({ error: 'Failed to approve post' }, { status: 500 })
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

    const { data: csRowBc } = await db
      .from('content_settings')
      .select('publish_time, bc_author, blog_url_prefix')
      .eq('client_id', String(p.client_id))
      .maybeSingle()
    type CsRowBc = { publish_time?: string | null; bc_author?: string | null; blog_url_prefix?: string | null }
    const csRowBcTyped  = csRowBc as CsRowBc | null
    const bcPublishTime = csRowBcTyped?.publish_time ?? '09:00'
    const bcAuthor      = csRowBcTyped?.bc_author ?? 'Admin'
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
        const pageBody = String((p as Record<string, unknown>).content ?? '')
        const pagePath = postSlug.startsWith('/') ? postSlug : `/${postSlug}`

        let bcPageId: number
        let bcPagePath: string
        if (existingBcId !== null) {
          await updateBCPage(storeHash, accessToken, existingBcId, { body: pageBody })
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
        body:             styleTables(String((p as Record<string, unknown>).content ?? '')),
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

  const auth = { username, app_password: appPassword }

  // Fetch publish time and wp_publish_mode from content settings
  const { data: csRow } = await db
    .from('content_settings')
    .select('publish_time, wp_publish_mode, default_author_id, default_category_ids')
    .eq('client_id', String(p.client_id))
    .maybeSingle()
  type CsRow = { publish_time?: string | null; wp_publish_mode?: string | null; default_author_id?: number | null; default_category_ids?: number[] | null }
  const cs             = csRow as CsRow | null
  const publishTime    = cs?.publish_time   ?? '09:00'
  const wpPublishMode  = cs?.wp_publish_mode ?? 'scheduled_draft'

  // Determine WP status and scheduled date from target_publish_date
  let wpPublishStatus: 'draft' | 'future' | 'publish' = 'draft'
  let wpDate: string | undefined
  if (wpPublishMode === 'draft_only') {
    // Always save as plain draft regardless of publish date
    wpPublishStatus = 'draft'
    wpDate = undefined
  } else if (p.target_publish_date) {
    wpDate = `${String(p.target_publish_date)}T${publishTime}:00`
    wpPublishStatus = new Date(wpDate) > new Date() ? 'future' : 'publish'
  }

  try {
    const tags   = Array.isArray(p.suggested_tags) ? (p.suggested_tags as string[]) : []
    const tagIds = tags.length > 0 ? await ensureTagIds(siteUrl, auth, tags) : []

    // Upload featured image to WP media library (non-fatal if it fails)
    let featuredMediaId: number | undefined
    if (p.featured_image_url) {
      try {
        featuredMediaId = await uploadMediaToWordPress(
          siteUrl, auth,
          String(p.featured_image_url),
          p.title ? String(p.title) : undefined
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
        saDate   = `${String(p.target_publish_date)}T${saPublishTime}:00`
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
            const res = await fetch(url, { headers: { Authorization: `Basic ${creds}` } })
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

      result = existingWpId !== null
        // `status` is deliberately omitted, exactly as in the blog branch below:
        // saStatus defaults to 'draft', so sending it would UN-PUBLISH a live
        // service-area page every time its content was re-pushed.
        ? await updatePage(siteUrl, auth, existingWpId, {
            title:   String(p.title ?? ''),
            content: styleTables(String(p.content ?? '')),
            slug:    wpSlug,
          })
        : await publishPage(siteUrl, auth, {
        title:   String(p.title ?? ''),
        content: styleTables(String(p.content ?? '')),
        status:  saStatus,
        date:    saDate,
        slug:    wpSlug,
        parent:  wpParent,
        meta: {
          rank_math_title:         p.seo_title        ? String(p.seo_title)        : String(p.title ?? ''),
          rank_math_description:   p.meta_description ? String(p.meta_description) : '',
          rank_math_focus_keyword: p.target_keyword   ? String(p.target_keyword)   : '',
        },
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

      const wpMeta = {
        rank_math_title:         p.seo_title        ? String(p.seo_title)        : String(p.title ?? ''),
        rank_math_description:   p.meta_description ? String(p.meta_description) : '',
        rank_math_focus_keyword: p.target_keyword   ? String(p.target_keyword)   : '',
      }

      result = existingWpId !== null
        // Already live — overwrite in place so the URL and any links to it survive.
        // `date` is deliberately omitted: re-pushing must not reschedule a post
        // that has already gone out.
        ? await updatePost(siteUrl, auth, existingWpId, {
            title:          String(p.title ?? ''),
            content:        styleTables(String(p.content ?? '')),
            slug:           p.slug ? String(p.slug) : undefined,
            tags:           tagIds.length > 0 ? tagIds : undefined,
            featured_media: featuredMediaId,
            categories:     postCategoryIds,
            meta:           wpMeta,
          })
        : await publishPost(siteUrl, auth, {
            title:          String(p.title ?? ''),
            content:        styleTables(String(p.content ?? '')),
            status:         wpPublishStatus,
            date:           wpDate,
            slug:           p.slug ? String(p.slug) : undefined,
            tags:           tagIds.length > 0 ? tagIds : undefined,
            featured_media: featuredMediaId,
            author:         authorId,
            categories:     postCategoryIds,
            meta:           wpMeta,
          })
    }

    const wpEditUrl = isServiceArea
      ? `${siteUrl}/wp-admin/post.php?post=${result.id}&action=edit`
      : `${siteUrl}/wp-admin/post.php?post=${result.id}&action=edit`

    await db.from('content_posts').update({
      wp_post_id:        result.id,
      wp_site_url:       siteUrl,
      wp_status:         isServiceArea ? result.status : wpPublishStatus,
      status:            'draft_saved',
      // Only a real permalink goes in published_url; the wp-admin fallback lives
      // in platform_edit_url so internal-link injection never emits it. And when
      // WP returns no link at all, keep whatever was already stored rather than
      // nulling a permalink that was previously correct.
      ...(result.link ? { published_url: result.link } : {}),
      platform_edit_url: wpEditUrl,
      last_pushed_at:    new Date().toISOString(),
      admin_approved_at: new Date().toISOString(),
    }).eq('id', id)

    // Inject nearby-city links into sibling SA pages (fire-and-forget)
    if (isServiceArea) {
      injectNearbyLinks(id, String(p.client_id), p.service_page_url ? String(p.service_page_url) : null)
        .catch(() => {})
    }

    // Auto-update WP hub page if this post belongs to a silo (fire-and-forget).
    // p.silo_id is only populated once migration 149 (content_silos) is applied.
    if ((p as Record<string, unknown>).silo_id) {
      ;(async () => {
        try {
          const { data: siloRaw } = await db
            .from('content_silos')
            .select('name, hub_page_url, central_entity, pending_links')
            .eq('id', String(p.silo_id))
            .single()
          if (!siloRaw?.hub_page_url) return
          const silo = siloRaw as { name: string; hub_page_url: string; central_entity: string | null; pending_links: { url: string; title: string; added_at: string }[] }
          const hubSlug = silo.hub_page_url.replace(/\/$/, '').split('/').pop() ?? ''
          if (!hubSlug) return
          const creds    = Buffer.from(`${auth.username}:${auth.app_password}`).toString('base64')
          const pagesRes = await fetch(
            `${siteUrl}/wp-json/wp/v2/pages?slug=${encodeURIComponent(hubSlug)}&per_page=1`,
            { headers: { Authorization: `Basic ${creds}` } }
          )
          if (!pagesRes.ok) return
          const pages = (await pagesRes.json()) as { id: number; status: string; content: { rendered: string } }[]
          if (!pages.length) return
          const hubId        = pages[0].id
          const hubStatus    = pages[0].status ?? 'draft'
          const current      = pages[0].content?.rendered ?? ''
          const clusterUrl   = result.link || wpEditUrl
          const clusterTitle = String(p.title ?? '')
          const entity       = silo.central_entity || silo.name
          const safeTitle    = clusterTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
          const safeUrl      = encodeURI(clusterUrl).replace(/"/g, '%22')
          const linkHtml     = `<li><a href="${safeUrl}">${safeTitle}</a></li>`
          const updatedContent = current.includes('<!-- silo-cluster-links -->')
            ? current.replace(/<\/ul>\s*<!-- \/silo-cluster-links -->/, `${linkHtml}\n</ul>\n<!-- /silo-cluster-links -->`)
            : `${current}\n<!-- silo-cluster-links -->\n<h3>Related ${entity} Resources</h3>\n<ul>\n${linkHtml}\n</ul>\n<!-- /silo-cluster-links -->`
          await fetch(`${siteUrl}/wp-json/wp/v2/pages/${hubId}`, {
            method:  'POST',
            headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ content: updatedContent, status: hubStatus }),
          })
          // Atomic append via RPC — prevents race condition when two cluster posts
          // from the same silo are pushed in the same batch (fetch-spread-update would overwrite)
          await db.rpc('append_silo_pending_link', {
            silo_id: String(p.silo_id),
            link: { url: clusterUrl, title: clusterTitle, added_at: new Date().toISOString() },
          })
        } catch (e) {
          console.error('[approve] silo hub update failed:', e)
        }
      })()
    }

    // Update silo page status to published + store final URL (fire-and-forget)
    if (p.silo_id) {
      ;(async () => {
        try {
          const publishedUrl = result.link || wpEditUrl
          await db.from('content_silo_pages')
            .update({ status: 'published', target_url: publishedUrl, updated_at: new Date().toISOString() })
            .eq('content_post_id', id)
            .eq('silo_id', String(p.silo_id))
        } catch (e) {
          console.error('[approve] silo page status update failed:', e)
        }
      })()
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

    return NextResponse.json({
      wp_post_id:    result.id,
      wp_site_url:   siteUrl,
      wp_edit_url:   wpEditUrl,
      published_url: wpEditUrl,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
