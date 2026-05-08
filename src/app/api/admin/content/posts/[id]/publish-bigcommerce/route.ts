// POST /api/admin/content/posts/[id]/publish-bigcommerce
// Publishes a for_review post to a BigCommerce Blog as a draft.

export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

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

  const { data: post, error: postErr } = await db
    .from('content_posts')
    .select('id, client_id, connection_id, title, content, seo_title, meta_description, slug, target_keyword, suggested_tags, target_publish_date, bc_post_id, focus_topic')
    .eq('id', id)
    .single()

  if (postErr || !post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  const p = post as Record<string, unknown>

  if (p.bc_post_id) {
    return NextResponse.json({ error: 'Post is already published to BigCommerce' }, { status: 400 })
  }

  // Resolve BC connection: prefer stored connection_id, fall back to any active BC connection
  type ConnRow = { id: string; connector: { auth: Record<string, unknown>; config: Record<string, unknown> } }
  let connData: ConnRow | null = null

  if (p.connection_id) {
    const { data } = await db
      .from('client_connections')
      .select('id, connector:connectors!inner(auth, config)')
      .eq('id', String(p.connection_id))
      .single()
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

  if (!storeHash || !accessToken) {
    return NextResponse.json({ error: 'BigCommerce credentials incomplete' }, { status: 400 })
  }

  const tags = Array.isArray(p.suggested_tags) ? (p.suggested_tags as string[]) : []
  const postSlug = p.slug
    ? String(p.slug)
    : `/blog/${slugify(String(p.title ?? p.focus_topic ?? 'post'))}/`

  const publishedDate = p.target_publish_date
    ? new Date(String(p.target_publish_date) + 'T08:00:00Z').toISOString()
    : new Date().toISOString()

  const payload = {
    title:            String(p.title ?? ''),
    body:             String(p.content ?? ''),
    author:           'Admin',
    url:              postSlug.startsWith('/') ? postSlug : `/${postSlug}`,
    is_published:     false,
    published_date:   publishedDate,
    summary:          String(p.meta_description ?? ''),
    meta_description: String(p.meta_description ?? ''),
    meta_keywords:    String(p.target_keyword ?? ''),
    tags,
  }

  try {
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
      throw new Error(`BigCommerce API error ${res.status}: ${text}`)
    }

    const bcPost = (await res.json()) as Record<string, unknown>

    await db.from('content_posts').update({
      bc_post_id:    Number(bcPost.id),
      bc_store_hash: storeHash,
      status:        'draft_saved',
    }).eq('id', id)

    return NextResponse.json({
      bc_post_id:  Number(bcPost.id),
      bc_edit_url: `https://store-${storeHash}.mybigcommerce.com/manage/site/content`,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
