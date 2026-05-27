// POST /api/admin/content/posts/[id]/approve
// Uploads an already-generated pending post to WordPress or BigCommerce as a draft.

export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { publishPost, ensureTagIds, uploadMediaToWordPress } from '@/lib/connectors/wordpress'
import { logActivity } from '@/lib/activity'
import { sendDiscordMessage } from '@/lib/discord'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const db = createAdminClient()

  const { data: post, error: postErr } = await db
    .from('content_posts')
    .select('id, client_id, connection_id, title, content, seo_title, meta_description, slug, focus_topic, target_keyword, suggested_tags, target_publish_date, wp_post_id, bc_post_id, featured_image_url')
    .eq('id', id)
    .single()

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

  // Resolve WP connection: prefer stored connection_id, fall back to any active WP connection
  type ConnRow = { id: string; external_id: string; connector: { auth: Record<string, unknown>; config: Record<string, unknown> } }
  let connData: ConnRow | null = null

  if (p.connection_id) {
    const { data } = await db
      .from('client_connections')
      .select('id, external_id, connector:connectors!inner(auth, config)')
      .eq('id', String(p.connection_id))
      .single()
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
        .single()
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
      const bcEditUrl = `https://store-${storeHash}.mybigcommerce.com/manage/site/content`

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

  // Fetch publish time from content settings
  const { data: csRow } = await db
    .from('content_settings')
    .select('publish_time')
    .eq('client_id', String(p.client_id))
    .maybeSingle()
  const publishTime = (csRow as { publish_time?: string | null } | null)?.publish_time ?? '09:00'

  // Determine WP status and scheduled date from target_publish_date
  let wpPublishStatus: 'draft' | 'future' | 'publish' = 'draft'
  let wpDate: string | undefined
  if (p.target_publish_date) {
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

    const result = await publishPost(siteUrl, auth, {
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

    const wpEditUrl = `${siteUrl}/wp-admin/post.php?post=${result.id}&action=edit`

    await db.from('content_posts').update({
      wp_post_id:    result.id,
      wp_site_url:   siteUrl,
      wp_status:     wpPublishStatus,
      status:        'draft_saved',
      published_url: wpEditUrl,
    }).eq('id', id)

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
