import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { publishPost, ensureTagIds } from '@/lib/connectors/wordpress'
import { logActivity } from '@/lib/activity'

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

  const db = createAdminClient()

  // Get the connection with its connector auth/config
  const { data: conn } = await db
    .from('client_connections')
    .select('*, connector:connectors!inner(auth, config)')
    .eq('id', connection_id)
    .single()

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
      content,
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

    // Update content_posts record if we have a post_id
    if (post_id) {
      await db.from('content_posts').update({
        wp_post_id:    result.id,
        wp_author_id:  author_id ?? null,
        published_url: result.link,
        wp_status:     wpStatus,
        status:        wpStatus === 'publish' ? 'published' : 'draft_saved',
        ...(wpStatus === 'publish' ? { published_at: new Date().toISOString() } : {}),
      }).eq('id', post_id)
    }

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
