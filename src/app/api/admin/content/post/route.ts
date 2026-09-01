import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed }     from '@/lib/auth'

function countWords(html: string)    { return html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length }
function countHeadings(html: string) { return (html.match(/<h[2-4][^>]*>/gi) || []).length }
function countIntLinks(html: string) { return (html.match(/<a [^>]+>/gi) || []).filter(l => !l.includes('http')).length }

/**
 * GET /api/admin/content/post?id={post_id}
 * Returns full post detail for the editor drawer.
 */
export async function GET(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const db = createAdminClient()

  const BASE_COLS = 'id, client_id, connection_id, content_type, status, target_keyword, title, seo_title, content, meta_description, slug, suggested_tags, word_count, heading_count, internal_links, published_url, wp_author_id, wp_category_ids, wp_post_id, wp_site_url, bc_post_id, bc_store_hash, featured_image_url, target_publish_date, topic_id'

  let { data, error } = await db
    .from('content_posts')
    .select(`${BASE_COLS}, image_candidates`)
    .eq('id', id)
    .single()

  // Deploy-order fallback: image_candidates only exists from migration 210, and
  // migrations here are applied by hand. Without this the whole review drawer would
  // 404 on every post until the migration lands — a far worse outcome than losing the
  // stock-image picker, which simply renders empty.
  if (error && /image_candidates/i.test(error.message)) {
    console.warn('[content/post] image_candidates missing (migration 210 not applied) — stock picker disabled')
    ;({ data, error } = await db
      .from('content_posts')
      .select(BASE_COLS)
      .eq('id', id)
      .single())
  }

  if (error || !data) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  const p = data as Record<string, unknown>
  const clientId      = String(p.client_id)
  const isServiceArea = p.content_type === 'service_area'

  // Fetch schedule config defaults so the editor can pre-populate WP Author and Publish As
  const [csRes, saRes] = await Promise.all([
    db.from('content_settings').select('default_author_id, wp_publish_mode, bc_author').eq('client_id', clientId).maybeSingle(),
    isServiceArea
      ? db.from('service_area_settings').select('wp_publish_mode, default_author_id').eq('client_id', clientId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const cs = (csRes.data ?? {}) as Record<string, unknown>
  const sa = (saRes.data  ?? {}) as Record<string, unknown>
  const scheduleDefaultAuthorId: number | null = isServiceArea
    ? ((sa.default_author_id != null ? Number(sa.default_author_id) : null) ?? (cs.default_author_id != null ? Number(cs.default_author_id) : null))
    : (cs.default_author_id != null ? Number(cs.default_author_id) : null)
  const schedulePublishMode: string = isServiceArea
    ? ((sa.wp_publish_mode as string | null) ?? (cs.wp_publish_mode as string | null) ?? 'draft_only')
    : ((cs.wp_publish_mode as string | null) ?? 'scheduled_draft')

  return NextResponse.json({
    id:              String(p.id),
    clientId,
    contentType:     p.content_type ? String(p.content_type) : 'blog',
    status:          String(p.status),
    targetKeyword:   p.target_keyword   ? String(p.target_keyword)   : null,
    title:           p.title            ? String(p.title)            : null,
    seoTitle:        p.seo_title        ? String(p.seo_title)        : null,
    content:         p.content          ? String(p.content)          : null,
    metaDescription: p.meta_description ? String(p.meta_description) : null,
    slug:            p.slug             ? String(p.slug)             : null,
    suggestedTags:   Array.isArray(p.suggested_tags) ? (p.suggested_tags as string[]) : [],
    wordCount:       (p.word_count   as number) ?? null,
    headingCount:    (p.heading_count as number) ?? null,
    internalLinks:   (p.internal_links as number) ?? null,
    publishedUrl:    p.published_url  ? String(p.published_url)  : null,
    wpAuthorId:        p.wp_author_id       ? Number(p.wp_author_id)       : null,
    wpCategoryIds:     Array.isArray(p.wp_category_ids) ? (p.wp_category_ids as number[]) : null,
    wpPostId:          p.wp_post_id         ? Number(p.wp_post_id)         : null,
    wpSiteUrl:         p.wp_site_url        ? String(p.wp_site_url)        : null,
    bcPostId:          p.bc_post_id         ? Number(p.bc_post_id)         : null,
    bcStoreHash:       p.bc_store_hash      ? String(p.bc_store_hash)      : null,
    featuredImageUrl:    p.featured_image_url  ? String(p.featured_image_url)  : null,
    targetPublishDate:   p.target_publish_date ? String(p.target_publish_date) : null,
    postConnectionId:    p.connection_id ? String(p.connection_id) : null,
    topicId:             p.topic_id ? String(p.topic_id) : null,
    // Openverse suggestions captured at generation time. Array = searched, [] = nothing
    // relevant enough, null/undefined = never searched (or migration 210 not applied).
    imageCandidates:     Array.isArray(p.image_candidates) ? p.image_candidates : [],
    scheduleDefaultAuthorId,
    schedulePublishMode,
    scheduleBcAuthor: cs.bc_author ? String(cs.bc_author) : null,
  })
}

/**
 * PATCH /api/admin/content/post?id={post_id}
 * Saves editable fields from the ContentPostEditor drawer before WP upload.
 */
export async function PATCH(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const body = await request.json() as {
    title?:            string
    seoTitle?:         string
    content?:          string
    metaDescription?:  string
    slug?:             string
    targetKeyword?:    string
    suggestedTags?:    string[]
    connectionId?:     string | null
    wpAuthorId?:       number | null
    featuredImageUrl?: string | null
    status?:           string
  }

  const updates: Record<string, unknown> = {}
  if (body.title         !== undefined) updates.title               = body.title
  if (body.seoTitle      !== undefined) updates.seo_title           = body.seoTitle
  if (body.content       !== undefined) {
    updates.content       = body.content
    updates.word_count    = countWords(body.content)
    updates.heading_count = countHeadings(body.content)
    updates.internal_links = countIntLinks(body.content)
  }
  if (body.metaDescription !== undefined) updates.meta_description  = body.metaDescription
  if (body.slug            !== undefined) updates.slug               = body.slug
  if (body.targetKeyword   !== undefined) updates.target_keyword     = body.targetKeyword
  if (body.suggestedTags   !== undefined) updates.suggested_tags     = body.suggestedTags
  if (body.connectionId      !== undefined) updates.connection_id      = body.connectionId
  if (body.wpAuthorId        !== undefined) updates.wp_author_id       = body.wpAuthorId
  if (body.featuredImageUrl  !== undefined) updates.featured_image_url = body.featuredImageUrl
  if (body.status !== undefined) {
    const ALLOWED_STATUSES = ['pending', 'for_review', 'approved', 'draft_saved', 'published', 'rejected', 'generating', 'error']
    if (!ALLOWED_STATUSES.includes(body.status))
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    updates.status = body.status
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true })
  }

  const db = createAdminClient()
  const { error } = await db.from('content_posts').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

