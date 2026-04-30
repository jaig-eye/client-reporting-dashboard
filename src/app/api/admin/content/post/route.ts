import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed }     from '@/lib/auth'

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

  const { data, error } = await db
    .from('content_posts')
    .select('id, client_id, status, target_keyword, title, seo_title, content, meta_description, slug, suggested_tags, word_count, heading_count, internal_links, published_url, wp_author_id, wp_post_id, wp_site_url')
    .eq('id', id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  const p = data as Record<string, unknown>
  return NextResponse.json({
    id:              String(p.id),
    clientId:        String(p.client_id),
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
    wpAuthorId:      p.wp_author_id   ? Number(p.wp_author_id)   : null,
    wpPostId:        p.wp_post_id     ? Number(p.wp_post_id)     : null,
    wpSiteUrl:       p.wp_site_url    ? String(p.wp_site_url)    : null,
  })
}
