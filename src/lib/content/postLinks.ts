// Shared WordPress / BigCommerce post-link builders.
//
// Used by the per-client pipeline cards, the monthly-review cards, and the
// ContentPostEditor On-Site banner so live-post preview links are built one way.
// Inputs accept both snake_case (DB/list rows) and camelCase (PostDetail) shapes.

export interface PostLinkInput {
  status?:        string | null
  published_url?: string | null; publishedUrl?: string | null
  wp_post_id?:    number | null; wpPostId?:     number | null
  wp_site_url?:   string | null; wpSiteUrl?:    string | null
  bc_post_id?:    number | null; bcPostId?:     number | null
  bc_store_hash?: string | null; bcStoreHash?:  string | null
}

const wpId   = (p: PostLinkInput) => p.wpPostId    ?? p.wp_post_id    ?? null
const wpSite = (p: PostLinkInput) => (p.wpSiteUrl  ?? p.wp_site_url   ?? null)?.replace(/\/+$/, '') || null
const bcId   = (p: PostLinkInput) => p.bcPostId    ?? p.bc_post_id    ?? null
const bcHash = (p: PostLinkInput) => p.bcStoreHash ?? p.bc_store_hash ?? null

/** The WP permalink (from published_url). Public once a scheduled post goes live. */
export function viewLiveUrl(p: PostLinkInput): string | null {
  return p.publishedUrl ?? p.published_url ?? null
}

/**
 * True when a URL is a real public permalink, not the wp-admin editor fallback.
 * The approve route can store a /wp-admin/ URL in published_url when WP returns
 * no permalink — in that case "View live" should not be shown (it'd duplicate the editor link).
 */
export function isPublicPermalink(url: string | null): boolean {
  return !!url && !url.includes('/wp-admin/')
}

/** WordPress draft preview — requires the viewer's WP login. WP only. */
export function wpDraftPreviewUrl(p: PostLinkInput): string | null {
  const site = wpSite(p), id = wpId(p)
  return site && id ? `${site}/?p=${id}&preview=true` : null
}

/** WordPress admin editor for the post. */
export function wpEditUrl(p: PostLinkInput): string | null {
  const site = wpSite(p), id = wpId(p)
  return site && id ? `${site}/wp-admin/post.php?post=${id}&action=edit` : null
}

/** BigCommerce blog manager (BC has no per-post edit deep link). */
export function bcEditUrl(p: PostLinkInput): string | null {
  const hash = bcHash(p)
  return hash ? `https://store-${hash}.mybigcommerce.com/manage/content/blog` : null
}

/** Whether the post has been pushed to a CMS (has a live/editor destination). */
export function isOnSite(p: PostLinkInput): boolean {
  return p.status === 'draft_saved' || p.status === 'published' || !!wpId(p) || !!bcId(p)
}

/** True when this is a WordPress post (vs BigCommerce) — drives which links show. */
export function isWpPost(p: PostLinkInput): boolean {
  return !!wpId(p) || (!bcId(p) && !bcHash(p))
}
