import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { publishPost, ensureTagIds } from '@/lib/connectors/wordpress'
import { logActivity } from '@/lib/activity'
import { stripEditorialMarkers } from '@/lib/content/contentHtml'

export async function POST(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const adminSession = await getAdminSession()
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()

  const body = await request.json()
  const {
    connection_id,
    post_id,
    title,
    content,
    status = 'draft',
    slug,
    meta_description,
    target_keyword,
    seo_title,
    author_id,
    tags,        // string[] — tag names, resolved to WP IDs
  } = body as {
    connection_id:    string
    post_id?:         string
    title:            string
    content:          string
    status?:          string
    slug?:            string
    meta_description?: string
    target_keyword?:   string
    seo_title?:        string
    author_id?:        number | null
    tags?:             string[]
  }

  if (!connection_id || !title || !content) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // ── The connection must belong to the post's client ─────────────────────────
  //
  // Both connection_id and post_id arrive in the request body, and nothing here related them
  // to each other: any admin session could publish one client's article onto another client's
  // WordPress, and stamp the resulting wp_post_id and published_url back onto our row so the
  // dashboard reported it as that client's own. The same check exists on the approve and
  // publish-bigcommerce routes; this one was missed because it is the older path.
  //
  // post_id is REQUIRED for that check to mean anything. It was optional, and the ownership
  // lookup was skipped entirely when it was absent — so the guard could be walked around by
  // simply not sending the field. There is no legitimate caller that publishes an article
  // belonging to no post, so the safe reading is also the correct one.
  if (!post_id) {
    return NextResponse.json(
      { error: 'post_id is required so the target site can be checked against the post’s client' },
      { status: 400 },
    )
  }

  const db = createAdminClient()

  let postClientId: string | null = null
  {
    const { data: postRow } = await db
      .from('content_posts')
      .select('client_id')
      .eq('id', post_id)
      .maybeSingle()

    if (!postRow) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }
    postClientId = String((postRow as { client_id: string }).client_id)
  }

  // Get the connection with its connector auth/config
  let connQuery = db
    .from('client_connections')
    .select('*, connector:connectors!inner(auth, config)')
    .eq('id', connection_id)

  if (postClientId) connQuery = connQuery.eq('client_id', postClientId)

  // maybeSingle, not single: a connection the caller may not use should read as "not found",
  // not throw a 406 out of PostgREST.
  const { data: conn } = await connQuery.maybeSingle()

  if (!conn) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  }

  const connector   = conn.connector as { auth: Record<string, unknown>; config: Record<string, unknown> }
  const siteUrl     = String(connector.config.site_url || conn.external_id || '')
  const username    = String(connector.config.username    || connector.auth.username    || '')
  const appPassword = String(connector.config.app_password || connector.auth.app_password || '')

  if (!siteUrl || !username || !appPassword) {
    return NextResponse.json({ error: 'WordPress credentials incomplete' }, { status: 400 })
  }

  const auth = { username, app_password: appPassword }

  try {
    // Resolve tag names → WP tag IDs (creates missing tags)
    const tagIds = (tags && tags.length > 0)
      ? await ensureTagIds(siteUrl, auth, tags)
      : []

    const wpStatus = (status === 'publish' || status === 'draft' || status === 'pending')
      ? status
      : 'draft'

    const result = await publishPost(siteUrl, auth, {
      title,
      // Internal <!-- INSIGHT/EXPERIENCE/MEDIA --> annotations must never reach a
      // client site. Every other CMS write path strips them; this legacy route
      // (still reachable from ContentEditor) did not.
      content: stripEditorialMarkers(content),
      status:  wpStatus,
      slug:    slug    || undefined,
      author:  author_id || undefined,
      tags:    tagIds.length > 0 ? tagIds : undefined,
      meta: {
        rank_math_title:         seo_title        || title,
        rank_math_description:   meta_description || '',
        rank_math_focus_keyword: target_keyword   || '',
      },
    })

    await db.from('content_posts').update({
      wp_post_id:    result.id,
      wp_author_id:  author_id ?? null,
      published_url: result.link,
      wp_status:     wpStatus,
      status:        wpStatus === 'publish' ? 'published' : 'draft_saved',
      // Stamped here as well as on the approve route. The drawer reads it against updated_at to
      // decide whether the live article is behind the row — so a post pushed through THIS route
      // and never through approve had no push recorded, and read as permanently stale.
      last_pushed_at: new Date().toISOString(),
      ...(wpStatus === 'publish' ? { published_at: new Date().toISOString() } : {}),
    }).eq('id', post_id)

    logActivity(adminSession, 'published', 'post', {
      resourceId: post_id,
      ip,
      meta: { title, wpStatus, site_url: siteUrl, wp_post_id: result.id },
    })
    return NextResponse.json({ ...result, url: result.link })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
