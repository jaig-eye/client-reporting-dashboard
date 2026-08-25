// POST /api/admin/content/posts/[id]/publish-bigcommerce
// Publishes a for_review post to a BigCommerce Blog as a draft.

export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { publishBCPage, updateBCPage, updateBCBlogPost, fetchBCPage, fetchBCStorefrontOrigin, bcPermalink } from '@/lib/connectors/bigcommerce'
import { injectNearbyLinks } from '@/lib/content/injectNearbyLinks'
import { stripEditorialMarkers } from '@/lib/content/contentHtml'

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

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

  // silo_id excluded: migration 149 (content_silos) not yet applied in production.
  // Selecting a non-existent column causes PostgREST to error → "Post not found" 404.
  const { data: post, error: postErr } = await db
    .from('content_posts')
    .select('id, client_id, connection_id, content_type, service_page_url, title, content, seo_title, meta_description, slug, target_keyword, suggested_tags, target_publish_date, bc_post_id, focus_topic, featured_image_url')
    .eq('id', id)
    .maybeSingle()

  if (postErr || !post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  const p = post as Record<string, unknown>

  // Already on BigCommerce => overwrite that post rather than refusing. Mirrors
  // the same change in ../approve; see migration 200 for why the old 400 wedged
  // any post that was regenerated after going live.
  const existingBcId = p.bc_post_id ? Number(p.bc_post_id) : null
  const isRepublish  = existingBcId !== null

  // Resolve BC connection: prefer stored connection_id, fall back to any active BC connection
  type ConnRow = { id: string; connector: { auth: Record<string, unknown>; config: Record<string, unknown> } }
  let connData: ConnRow | null = null

  if (p.connection_id) {
    const { data } = await db
      .from('client_connections')
      .select('id, connector:connectors!inner(auth, config)')
      .eq('id', String(p.connection_id))
      .maybeSingle()
    connData = data as ConnRow | null
  }

  if (!connData) {
    const { data } = await db
      .from('client_connections')
      .select('id, connector:connectors!inner(type, auth, config)')
      .eq('client_id', String(p.client_id))
      .eq('status', 'active')
      .eq('connector.type', 'bigcommerce')
      .limit(1)
      .maybeSingle()
    connData = data as ConnRow | null
  }

  if (!connData) {
    return NextResponse.json({ error: 'No BigCommerce connection found for this client' }, { status: 400 })
  }

  const { connector } = connData
  const storeHash   = String(connector.config.store_hash   || connector.auth.store_hash   || '')
  const accessToken = String(connector.config.access_token || connector.auth.access_token || '')

  console.log('[publish-bigcommerce] connection_id:', connData.id, '| store_hash:', storeHash, '| token prefix:', accessToken.slice(0, 6) + '…')

  if (!storeHash || !accessToken) {
    return NextResponse.json({ error: 'BigCommerce credentials incomplete' }, { status: 400 })
  }

  // Upload featured image to BC CDN before creating the post.
  // BC's thumbnail_path expects a path on their CDN — external URLs render as broken images.
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
        } else {
          console.warn('[publish-bigcommerce] image upload to BC failed:', await uploadRes.text())
        }
      }
    } catch (imgErr) {
      console.warn('[publish-bigcommerce] image upload skipped:', imgErr)
    }
  }

  const tags = Array.isArray(p.suggested_tags) ? (p.suggested_tags as string[]) : []
  const postSlug = p.slug
    ? String(p.slug)
    : `/blog/${slugify(String(p.title ?? p.focus_topic ?? 'post'))}/`

  const { data: csRow } = await db
    .from('content_settings')
    .select('publish_time')
    .eq('client_id', String(p.client_id))
    .maybeSingle()
  const publishTime = (csRow as { publish_time?: string | null } | null)?.publish_time ?? '09:00'

  const publishedDate = p.target_publish_date
    ? new Date(`${String(p.target_publish_date)}T${publishTime}:00`).toUTCString()
    : new Date().toUTCString()

  const payload: Record<string, unknown> = {
    title:            String(p.title ?? ''),
    body:             stripEditorialMarkers(String(p.content ?? '')),
    author:           'Admin',
    url:              postSlug.startsWith('/') ? postSlug : `/${postSlug}`,
    is_published:     false,
    published_date:   publishedDate,
    meta_description: String(p.meta_description ?? ''),
    meta_keywords:    String(p.target_keyword ?? ''),
    tags,
    ...(thumbnailPath ? { thumbnail_path: thumbnailPath } : {}),
  }

  try {
    // Service area pages use the BC pages API, not the blog API
    if (p.content_type === 'service_area') {
      const pagePath = postSlug.startsWith('/') ? postSlug : `/${postSlug}`

      let bcPageId:   number
      let bcPagePath: string
      if (existingBcId !== null) {
        await updateBCPage(storeHash, accessToken, existingBcId, { body: stripEditorialMarkers(String(p.content ?? '')), name: String(p.title ?? '') })
        bcPageId   = existingBcId
        bcPagePath = (await fetchBCPage(storeHash, accessToken, existingBcId))?.url ?? pagePath
      } else {
        const bcPage = await publishBCPage(storeHash, accessToken, {
          name:       String(p.title ?? ''),
          body:       stripEditorialMarkers(String(p.content ?? '')),
          url:        pagePath,
          is_visible: false,
        })
        bcPageId   = bcPage.id
        bcPagePath = bcPage.url || pagePath
      }

      const bcEditUrl = `https://store-${storeHash}.mybigcommerce.com/manage/content/pages`
      const publicUrl = bcPermalink(await fetchBCStorefrontOrigin(storeHash, accessToken), bcPagePath)

      await db.from('content_posts').update({
        bc_post_id:        bcPageId,
        bc_store_hash:     storeHash,
        status:            'draft_saved',
        // Only overwrite when we actually resolved one - a transient storefront
        // lookup failure must not wipe a permalink we already had.
        ...(publicUrl ? { published_url: publicUrl } : {}),
        platform_edit_url: bcEditUrl,
        last_pushed_at:    new Date().toISOString(),
      }).eq('id', id)

      const adminSession = await getAdminSession()
      logActivity(adminSession, isRepublish ? 'republished' : 'published', 'post', {
        resourceId: id,
        clientId: String(p.client_id),
        meta: { title: p.title, bc_page_id: bcPageId, republished: isRepublish },
      })

      injectNearbyLinks(id, String(p.client_id), p.service_page_url ? String(p.service_page_url) : null)
        .catch(() => {})

      // Log cluster link to silo pending_links — atomic append to prevent race
      // conditions. Only a real permalink is worth linking to, and only once.
      if (p.silo_id && publicUrl && !isRepublish) {
        Promise.resolve(db.rpc('append_silo_pending_link', {
          silo_id: String(p.silo_id),
          link: { url: publicUrl, title: String(p.title ?? ''), added_at: new Date().toISOString() },
        })).catch(() => {})
      }

      return NextResponse.json({ bc_post_id: bcPageId, bc_edit_url: bcEditUrl, published_url: publicUrl, republished: isRepublish })
    }

    let bcPostId:   number
    let bcPostPath: string

    if (existingBcId !== null) {
      const updated = await updateBCBlogPost(storeHash, accessToken, existingBcId, {
        title:            String(payload.title ?? ''),
        body:             String(payload.body ?? ''),
        meta_description: String(payload.meta_description ?? ''),
        meta_keywords:    String(payload.meta_keywords ?? ''),
        tags:             payload.tags as string[] | undefined,
      })
      bcPostId   = updated.id
      bcPostPath = updated.url || String(payload.url ?? '')
    } else {
      const res = await fetch(
        `https://api.bigcommerce.com/stores/${storeHash}/v2/blog/posts`,
        {
          method:  'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auth-Token': accessToken,
            'Accept':       'application/json',
          },
          body: JSON.stringify(payload),
        }
      )

      if (!res.ok) {
        const text = await res.text()
        if (res.status === 401) {
          throw new Error(
            'BigCommerce rejected the access token (401). Reconnect the integration and ensure the API account has "Content: Modify" scope enabled.'
          )
        }
        throw new Error(`BigCommerce API error ${res.status}: ${text}`)
      }

      const bcPost = (await res.json()) as Record<string, unknown>
      bcPostId   = Number(bcPost.id)
      bcPostPath = String(bcPost.url || payload.url || '')
    }

    const bcEditUrl = `https://store-${storeHash}.mybigcommerce.com/manage/content/blog`
    const publicUrl = bcPermalink(await fetchBCStorefrontOrigin(storeHash, accessToken), bcPostPath)

    await db.from('content_posts').update({
      bc_post_id:        bcPostId,
      bc_store_hash:     storeHash,
      status:            'draft_saved',
      // Only overwrite when we actually resolved one - a transient storefront
      // lookup failure must not wipe a permalink we already had.
      ...(publicUrl ? { published_url: publicUrl } : {}),
      platform_edit_url: bcEditUrl,
      last_pushed_at:    new Date().toISOString(),
    }).eq('id', id)

    const adminSession = await getAdminSession()
    logActivity(adminSession, isRepublish ? 'republished' : 'published', 'post', {
      resourceId: id,
      clientId: String(p.client_id),
      meta: { title: p.title, bc_post_id: bcPostId, republished: isRepublish },
    })

    // Log cluster link to silo pending_links — atomic append to prevent race
    // conditions. Only a real permalink is worth linking to, and only once.
    if (p.silo_id && publicUrl && !isRepublish) {
      Promise.resolve(db.rpc('append_silo_pending_link', {
        silo_id: String(p.silo_id),
        link: { url: publicUrl, title: String(p.title ?? ''), added_at: new Date().toISOString() },
      })).catch(() => {})
    }

    // The response always carries the key — the conditional spread above is a
    // DB-write concern only; callers here expect published_url to be present.
    return NextResponse.json({
      bc_post_id:    bcPostId,
      bc_edit_url:   bcEditUrl,
      published_url: publicUrl,
      republished:   isRepublish,
    })
  } catch (err) {
    console.error('[publish-bigcommerce]', err)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
