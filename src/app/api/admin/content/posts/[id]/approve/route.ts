// POST /api/admin/content/posts/[id]/approve
// Uploads an already-generated pending post to WordPress or BigCommerce as a draft.

export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { publishPost, publishPage, ensureTagIds, uploadMediaToWordPress } from '@/lib/connectors/wordpress'
import { publishBCPage } from '@/lib/connectors/bigcommerce'
import { logActivity }        from '@/lib/activity'
import { sendDiscordMessage }  from '@/lib/discord'
import { injectNearbyLinks }   from '@/lib/content/injectNearbyLinks'

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
    .select('id, client_id, connection_id, title, content, seo_title, meta_description, slug, focus_topic, target_keyword, suggested_tags, target_publish_date, wp_post_id, bc_post_id, featured_image_url, content_type, city, state_abbr, service_name, service_page_url, silo_id')
    .eq('id', id)
    .maybeSingle()

  if (postErr || !post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  const p = post as Record<string, unknown>

  if (p.wp_post_id) {
    return NextResponse.json({ error: 'Post is already uploaded to WordPress' }, { status: 400 })
  }
  if (p.bc_post_id) {
    return NextResponse.json({ error: 'Post is already published to BigCommerce' }, { status: 400 })
  }

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
      .select('publish_time')
      .eq('client_id', String(p.client_id))
      .maybeSingle()
    const bcPublishTime = (csRowBc as { publish_time?: string | null } | null)?.publish_time ?? '09:00'

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
        const bcPage = await publishBCPage(storeHash, accessToken, {
          name:       String(p.title ?? ''),
          body:       String((p as Record<string, unknown>).content ?? ''),
          url:        postSlug.startsWith('/') ? postSlug : `/${postSlug}`,
          is_visible: false,
        })
        const bcEditUrl = `https://store-${storeHash}.mybigcommerce.com/manage/content/pages`

        await db.from('content_posts').update({
          bc_post_id:    bcPage.id,
          bc_store_hash: storeHash,
          status:        'draft_saved',
          published_url: bcEditUrl,
        }).eq('id', id)

        const adminSession = await getAdminSession()
        logActivity(adminSession, 'approved', 'post', {
          resourceId: id, clientId: String(p.client_id),
          meta: { title: p.title, bc_page_id: bcPage.id },
        })

        // Inject nearby-city links (fire-and-forget)
        injectNearbyLinks(id, String(p.client_id), p.service_page_url ? String(p.service_page_url) : null)
          .catch(() => {})

        return NextResponse.json({ bc_post_id: bcPage.id, bc_edit_url: bcEditUrl, published_url: bcEditUrl })
      }

      const bcPayload: Record<string, unknown> = {
        title:            String(p.title ?? ''),
        body:             String((p as Record<string, unknown>).content ?? ''),
        author:           'Admin',
        url:              postSlug.startsWith('/') ? postSlug : `/${postSlug}`,
        is_published:     false,
        published_date:   publishedDate,
        meta_description: String((p as Record<string, unknown>).meta_description ?? ''),
        meta_keywords:    String(p.target_keyword ?? ''),
        tags,
        ...(thumbnailPath ? { thumbnail_path: thumbnailPath } : {}),
      }

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
      const bcEditUrl = `https://store-${storeHash}.mybigcommerce.com/manage/content/blog`

      await db.from('content_posts').update({
        bc_post_id:    Number(bcPost.id),
        bc_store_hash: storeHash,
        status:        'draft_saved',
        published_url: bcEditUrl,
      }).eq('id', id)

      const adminSession = await getAdminSession()
      logActivity(adminSession, 'approved', 'post', {
        resourceId: id,
        clientId: String(p.client_id),
        meta: { title: p.title, bc_post_id: Number(bcPost.id) },
      })

      return NextResponse.json({ bc_post_id: Number(bcPost.id), bc_edit_url: bcEditUrl, published_url: bcEditUrl })
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
    .select('publish_time, wp_publish_mode')
    .eq('client_id', String(p.client_id))
    .maybeSingle()
  const publishTime    = (csRow as { publish_time?: string | null; wp_publish_mode?: string | null } | null)?.publish_time ?? '09:00'
  const wpPublishMode  = (csRow as { publish_time?: string | null; wp_publish_mode?: string | null } | null)?.wp_publish_mode ?? 'scheduled_draft'

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
      const saSettingsRes = await db.from('service_area_settings').select('wp_publish_mode, publish_time, slug_structure').eq('client_id', String(p.client_id)).maybeSingle()
      const saSettings    = (saSettingsRes.data ?? {}) as Record<string, unknown>
      const saPublishMode = (saSettings.wp_publish_mode as string | null) ?? 'draft_only'
      const saPublishTime = (saSettings.publish_time    as string | null) ?? '09:00'
      const saSlugStruct  = (saSettings.slug_structure  as string | null) ?? ''

      let saStatus: 'draft' | 'future' | 'publish' = 'draft'
      let saDate: string | undefined
      if (isAuto || saPublishMode === 'publish') {
        // Auto-push from cron or explicit publish mode — go live immediately
        saStatus = 'publish'
      } else if (saPublishMode !== 'draft_only' && p.target_publish_date) {
        saDate   = `${String(p.target_publish_date)}T${saPublishTime}:00`
        saStatus = new Date(saDate) > new Date() ? 'future' : 'publish'
      }

      // For hierarchical slug structures (service/city), look up the parent WP page
      // and use only the child slug so WordPress stores it under the correct parent.
      const rawSlug = p.slug ? String(p.slug) : ''
      let wpSlug: string | undefined = rawSlug || undefined
      let wpParent: number | undefined

      const isHierarchical = (saSlugStruct === 'service_slash_city_state' || saSlugStruct === 'service_slash_city') && rawSlug.includes('/')
      if (isHierarchical) {
        const parts      = rawSlug.split('/').filter(Boolean)
        const parentSlug = parts[0]
        const childSlug  = parts[1]
        if (childSlug) {
          wpSlug = childSlug
          try {
            const creds = Buffer.from(`${auth.username}:${auth.app_password}`).toString('base64')
            const res   = await fetch(`${siteUrl}/wp-json/wp/v2/pages?slug=${encodeURIComponent(parentSlug)}&per_page=1`, {
              headers: { Authorization: `Basic ${creds}` },
            })
            if (res.ok) {
              const pages = (await res.json()) as { id: number }[]
              if (pages.length > 0) wpParent = pages[0].id
            }
          } catch {
            // non-fatal — publish without parent if lookup fails
          }
        }
      }

      result = await publishPage(siteUrl, auth, {
        title:   String(p.title ?? ''),
        content: String(p.content ?? ''),
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
      result = await publishPost(siteUrl, auth, {
        title:          String(p.title ?? ''),
        content:        String(p.content ?? ''),
        status:         wpPublishStatus,
        date:           wpDate,
        slug:           p.slug ? String(p.slug) : undefined,
        tags:           tagIds.length > 0 ? tagIds : undefined,
        featured_media: featuredMediaId,
        meta: {
          rank_math_title:         p.seo_title        ? String(p.seo_title)        : String(p.title ?? ''),
          rank_math_description:   p.meta_description ? String(p.meta_description) : '',
          rank_math_focus_keyword: p.target_keyword   ? String(p.target_keyword)   : '',
        },
      })
    }

    const wpEditUrl = isServiceArea
      ? `${siteUrl}/wp-admin/post.php?post=${result.id}&action=edit`
      : `${siteUrl}/wp-admin/post.php?post=${result.id}&action=edit`

    await db.from('content_posts').update({
      wp_post_id:    result.id,
      wp_site_url:   siteUrl,
      wp_status:     isServiceArea ? result.status : wpPublishStatus,
      status:        'draft_saved',
      published_url: result.link || wpEditUrl,
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
          const linkHtml     = `<li><a href="${clusterUrl}">${clusterTitle}</a></li>`
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

    const adminSession = await getAdminSession()
    logActivity(adminSession, 'approved', 'post', {
      resourceId: id,
      clientId: String(p.client_id),
      meta: { title: p.title, site: siteUrl, wp_post_id: result.id },
    })

    // Discord notification (fire-and-forget)
    try {
      const [{ data: agencySettings }, { data: client }] = await Promise.all([
        db.from('agency_settings').select('discord_bot_token').single(),
        db.from('clients').select('name, discord_channel_id').eq('id', String(p.client_id)).single(),
      ])
      const botToken   = (agencySettings as { discord_bot_token?: string | null } | null)?.discord_bot_token
      const channelId  = (client as { discord_channel_id?: string | null } | null)?.discord_channel_id
      const clientName = (client as { name?: string } | null)?.name ?? ''
      if (botToken && channelId) {
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
