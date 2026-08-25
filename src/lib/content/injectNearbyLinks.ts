// Inject "Cities We Also Serve" section into sibling service area pages
// after a new SA page has been pushed to WordPress or BigCommerce.
// Fire-and-forget — failures are swallowed so they don't block the approval response.

import { createAdminClient } from '@/lib/supabase/server'
import { updatePage }        from '@/lib/connectors/wordpress'
import { updateBCPage }      from '@/lib/connectors/bigcommerce'
import { isPublicPermalink }  from '@/lib/content/postLinks'

interface NearbyLinkPost {
  id:             string
  city:           string | null
  state_abbr:     string | null
  published_url:  string | null
  wp_post_id:     number | null
  wp_site_url:    string | null
  bc_post_id:     number | null
  bc_store_hash:  string | null
  content:        string | null
  service_page_url: string | null
}

const MAX_LINKS = 50

function buildNearbySection(links: { city: string; state: string; url: string }[]): string {
  const items = links
    .slice(0, MAX_LINKS)
    .map(l => `<li><a href="${l.url}">${l.city}, ${l.state}</a></li>`)
    .join('\n')
  return `\n<h2>Cities We Also Serve</h2>\n<ul>\n${items}\n</ul>\n`
}

function alreadyHasNearbySection(content: string): boolean {
  return content.includes('Cities We Also Serve')
}

export async function injectNearbyLinks(
  currentPostId:  string,
  clientId:       string,
  servicePageUrl: string | null,
): Promise<void> {
  if (!servicePageUrl) return

  const db = createAdminClient()

  // Honour the per-silo internal-linking switch.
  //
  // Without this the toggle would only soften a sentence in the generation
  // prompt while this injector kept writing cross-links directly into live CMS
  // pages — i.e. "linking off" would not actually turn linking off.
  const { data: ownerPost } = await db
    .from('content_posts')
    .select('silo_id')
    .eq('id', currentPostId)
    .maybeSingle()

  const ownerSiloId = (ownerPost as { silo_id?: string | null } | null)?.silo_id ?? null
  if (ownerSiloId) {
    const { data: silo } = await db
      .from('content_silos')
      .select('inject_internal_links')
      .eq('id', ownerSiloId)
      .maybeSingle()
    // Only an explicit false opts out; a missing column (migration 201 not yet
    // applied) leaves the previous always-on behaviour intact.
    if ((silo as { inject_internal_links?: boolean } | null)?.inject_internal_links === false) return
  }

  // Find all pushed sibling SA pages for the same service
  const { data: siblings } = await db
    .from('content_posts')
    .select('id, city, state_abbr, published_url, wp_post_id, wp_site_url, bc_post_id, bc_store_hash, content, service_page_url')
    .eq('client_id', clientId)
    .eq('content_type', 'service_area')
    .eq('service_page_url', servicePageUrl)
    .in('status', ['draft_saved', 'published'])
    .neq('id', currentPostId)

  if (!siblings || siblings.length === 0) return

  // Get the current post's URL for linking back
  const { data: currentPost } = await db
    .from('content_posts')
    .select('city, state_abbr, published_url, wp_post_id, wp_site_url, bc_post_id, bc_store_hash')
    .eq('id', currentPostId)
    .single()

  const allPosts = [...(siblings as NearbyLinkPost[]), { ...(currentPost as NearbyLinkPost), id: currentPostId }]
    // A published_url must be a PUBLIC permalink before it can become an href.
    // Before migration 202 every BigCommerce post carried the store-admin URL here,
    // so this injector emitted links into client content that pointed at the
    // BigCommerce control panel. Filter on the predicate, not on truthiness.
    .filter(p => isPublicPermalink(p.published_url ?? null))

  // Resolve connection auth for WP
  const wpSiteUrl = (currentPost as NearbyLinkPost | null)?.wp_site_url
    ?? (siblings as NearbyLinkPost[]).find(s => s.wp_site_url)?.wp_site_url ?? null

  let wpAuth: { username: string; app_password: string } | null = null
  if (wpSiteUrl) {
    const { data: connData } = await db
      .from('client_connections')
      .select('connector:connectors!inner(config, auth)')
      .eq('client_id', clientId)
      .eq('status', 'active')
      .eq('connector.type', 'wordpress')
      .maybeSingle()
    const conn = (connData as { connector: { config: Record<string, unknown>; auth: Record<string, unknown> } } | null)?.connector
    if (conn) {
      const u  = String(conn.config.username    || conn.auth.username    || '')
      const pw = String(conn.config.app_password || conn.auth.app_password || '')
      if (u && pw) wpAuth = { username: u, app_password: pw }
    }
  }

  // Resolve BC credentials
  const bcStoreHash = (currentPost as NearbyLinkPost | null)?.bc_store_hash
    ?? (siblings as NearbyLinkPost[]).find(s => s.bc_store_hash)?.bc_store_hash ?? null
  let bcAccessToken: string | null = null
  if (bcStoreHash) {
    const { data: bcConn } = await db
      .from('client_connections')
      .select('connector:connectors!inner(config, auth)')
      .eq('client_id', clientId)
      .eq('status', 'active')
      .eq('connector.type', 'bigcommerce')
      .maybeSingle()
    const conn = (bcConn as { connector: { config: Record<string, unknown>; auth: Record<string, unknown> } } | null)?.connector
    if (conn) {
      bcAccessToken = String(conn.config.access_token || conn.auth.access_token || '') || null
    }
  }

  // For each post (including the current one), build a links list of all other posts
  for (const post of allPosts as NearbyLinkPost[]) {
    const postId = post.id === currentPostId ? currentPostId : post.id
    const others = allPosts.filter(p => {
      const pid = p.id === currentPostId ? currentPostId : p.id
      return pid !== postId && p.city && isPublicPermalink(p.published_url ?? null)
    })

    if (others.length === 0) continue

    const links = others.map(o => ({
      city:  o.city!,
      state: o.state_abbr ?? '',
      url:   o.published_url!,
    }))

    const existingContent = post.content ?? ''
    if (alreadyHasNearbySection(existingContent)) continue

    const updatedContent = existingContent + buildNearbySection(links)

    // Update via WP
    if (post.wp_post_id && wpAuth && wpSiteUrl) {
      await updatePage(wpSiteUrl, wpAuth, post.wp_post_id, { content: updatedContent }).catch(() => {})
    }

    // Update via BC
    if (post.bc_post_id && bcStoreHash && bcAccessToken) {
      await updateBCPage(bcStoreHash, bcAccessToken, post.bc_post_id, { body: updatedContent }).catch(() => {})
    }

    // Update DB content cache
    await db.from('content_posts').update({ content: updatedContent }).eq('id', postId).then(null, () => {})
  }
}
