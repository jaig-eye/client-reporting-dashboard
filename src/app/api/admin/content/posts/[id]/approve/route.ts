// POST /api/admin/content/posts/[id]/approve
// Uploads an already-generated pending post to WordPress as a draft.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import { publishPost, ensureTagIds } from '@/lib/connectors/wordpress'

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
    .select('id, client_id, connection_id, title, content, seo_title, meta_description, slug, target_keyword, suggested_tags, target_publish_date, wp_post_id')
    .eq('id', id)
    .single()

  if (postErr || !post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  const p = post as Record<string, unknown>

  if (p.wp_post_id) {
    return NextResponse.json({ error: 'Post is already uploaded to WordPress' }, { status: 400 })
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
    return NextResponse.json({ error: 'No WordPress connection found for this client' }, { status: 400 })
  }

  const { connector, external_id } = connData
  const siteUrl     = String(connector.config.site_url    || external_id || '')
  const username    = String(connector.config.username    || connector.auth.username    || '')
  const appPassword = String(connector.config.app_password || connector.auth.app_password || '')

  if (!siteUrl || !username || !appPassword) {
    return NextResponse.json({ error: 'WordPress credentials incomplete' }, { status: 400 })
  }

  const auth = { username, app_password: appPassword }

  try {
    const tags   = Array.isArray(p.suggested_tags) ? (p.suggested_tags as string[]) : []
    const tagIds = tags.length > 0 ? await ensureTagIds(siteUrl, auth, tags) : []

    const result = await publishPost(siteUrl, auth, {
      title:   String(p.title ?? ''),
      content: String(p.content ?? ''),
      status:  'draft',
      slug:    p.slug ? String(p.slug) : undefined,
      tags:    tagIds.length > 0 ? tagIds : undefined,
      meta: {
        rank_math_title:         p.seo_title        ? String(p.seo_title)        : String(p.title ?? ''),
        rank_math_description:   p.meta_description ? String(p.meta_description) : '',
        rank_math_focus_keyword: p.target_keyword   ? String(p.target_keyword)   : '',
      },
    })

    await db.from('content_posts').update({
      wp_post_id:  result.id,
      wp_site_url: siteUrl,
      wp_status:   'draft',
      status:      'draft_saved',
    }).eq('id', id)

    return NextResponse.json({
      wp_post_id:  result.id,
      wp_edit_url: `${siteUrl}/wp-admin/post.php?post=${result.id}&action=edit`,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
