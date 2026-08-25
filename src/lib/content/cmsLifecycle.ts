// ─────────────────────────────────────────────────────────────────────────────
// What happens to the LIVE copy when a post's life in the dashboard changes.
//
// Rejecting, discarding or regenerating a post has always been a dashboard-only
// act: the article stayed on the client's site regardless. That is why 14
// rejected posts are currently live on WordPress with no way to reach them from
// here. This module gives those actions a defined effect on the CMS.
//
// Three outcomes, deliberately named for what the visitor sees:
//   'leave'     — do nothing. The article stays published. (Always the default.)
//   'unpublish' — revert to draft / hide from the storefront. Reversible.
//   'delete'    — remove it. WordPress trashes (recoverable in wp-admin);
//                 BigCommerce has no trash, so it is permanent.
//
// Nothing here runs implicitly. Every caller passes an explicit action that came
// from a human choosing it in a dialog.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  deleteWpContent,
  setWpContentStatus,
} from '@/lib/connectors/wordpress'
import {
  deleteBCContent,
  setBCContentVisibility,
} from '@/lib/connectors/bigcommerce'

export const CMS_ACTIONS = ['leave', 'unpublish', 'delete'] as const
export type CmsAction = typeof CMS_ACTIONS[number]

export function isCmsAction(v: unknown): v is CmsAction {
  return typeof v === 'string' && (CMS_ACTIONS as readonly string[]).includes(v)
}

export interface CmsActionResult {
  applied:   CmsAction
  platform:  'wordpress' | 'bigcommerce' | null
  ok:        boolean
  /** Human-readable outcome for a toast. */
  message:   string
  /** True when the CMS said the content was already gone. */
  alreadyGone?: boolean
}

interface LivePost {
  id:            string
  client_id:     string
  content_type:  string | null
  wp_post_id:    number | null
  wp_site_url:   string | null
  bc_post_id:    number | null
  bc_store_hash: string | null
}

/** True when this row claims a copy on a CMS. */
export function isOnCms(p: Partial<LivePost> | null | undefined): boolean {
  return Boolean(p?.wp_post_id || p?.bc_post_id)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>

async function wpCreds(db: Db, clientId: string) {
  const { data } = await db
    .from('client_connections')
    .select('id, connector:connectors!inner(type, auth, config)')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .eq('connector.type', 'wordpress')
    .limit(1)
    .maybeSingle()
  const c = data as { connector: { auth: Record<string, unknown>; config: Record<string, unknown> } } | null
  if (!c) return null
  // config FIRST, then auth. The only path that creates a wordpress connector
  // (direct-connections) writes credentials into `config` and leaves `auth` as
  // the empty default from migration 015 — all 15 production WP connectors are
  // shaped that way. Reading auth alone returned null every time, which made the
  // entire live-post lifecycle a no-op for every WordPress client. Every other
  // resolver in the repo already does config-then-auth; this one did not.
  const siteUrl      = String(c.connector.config.site_url     || c.connector.auth.site_url     || '')
  const username     = String(c.connector.config.username     || c.connector.auth.username     || '')
  const app_password = String(c.connector.config.app_password || c.connector.auth.app_password || '')
  if (!siteUrl || !username || !app_password) return null
  return { siteUrl, username, app_password }
}

async function bcCreds(db: Db, clientId: string) {
  const { data } = await db
    .from('client_connections')
    .select('id, connector:connectors!inner(type, auth, config)')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .eq('connector.type', 'bigcommerce')
    .limit(1)
    .maybeSingle()
  const c = data as { connector: { auth: Record<string, unknown>; config: Record<string, unknown> } } | null
  if (!c) return null
  const storeHash   = String(c.connector.config.store_hash   || c.connector.auth.store_hash   || '')
  const accessToken = String(c.connector.config.access_token || c.connector.auth.access_token || '')
  if (!storeHash || !accessToken) return null
  return { storeHash, accessToken }
}

/**
 * Apply an action to the live copy of a post and reconcile the DB row.
 *
 * On a successful delete the platform ids and published_url are cleared, so the
 * row stops claiming a live copy. That also un-wedges it: with no platform id,
 * a later push creates a fresh post instead of being refused.
 */
export async function applyCmsAction(
  db: Db,
  postId: string,
  action: CmsAction,
): Promise<CmsActionResult> {
  if (action === 'leave') {
    return { applied: 'leave', platform: null, ok: true, message: 'Left the published article in place' }
  }

  const { data } = await db
    .from('content_posts')
    .select('id, client_id, content_type, wp_post_id, wp_site_url, bc_post_id, bc_store_hash')
    .eq('id', postId)
    .maybeSingle()

  const post = data as unknown as LivePost | null
  if (!post || !isOnCms(post)) {
    return { applied: action, platform: null, ok: true, message: 'Nothing published to remove' }
  }

  const isPage = post.content_type === 'service_area'

  try {
    if (post.wp_post_id) {
      const creds = await wpCreds(db, post.client_id)
      if (!creds) {
        return { applied: action, platform: 'wordpress', ok: false, message: 'No active WordPress connection for this client' }
      }
      const siteUrl = post.wp_site_url || creds.siteUrl
      const auth = { username: creds.username, app_password: creds.app_password }
      const kind: 'post' | 'page' = isPage ? 'page' : 'post'

      if (action === 'unpublish') {
        await setWpContentStatus(siteUrl, auth, kind, post.wp_post_id, 'draft')
        return { applied: action, platform: 'wordpress', ok: true, message: 'Reverted to a WordPress draft — still recoverable' }
      }

      // force:false trashes rather than destroying, so a mistaken click can be
      // undone from wp-admin.
      const res = await deleteWpContent(siteUrl, auth, kind, post.wp_post_id, false)
      await clearPlatformRefs(db, postId)
      return {
        applied: action, platform: 'wordpress', ok: true, alreadyGone: res.alreadyGone,
        message: res.alreadyGone
          ? 'Already gone from WordPress — the dashboard record has been reconciled'
          : 'Moved to the WordPress trash (recoverable from wp-admin)',
      }
    }

    if (post.bc_post_id) {
      const creds = await bcCreds(db, post.client_id)
      if (!creds) {
        return { applied: action, platform: 'bigcommerce', ok: false, message: 'No active BigCommerce connection for this client' }
      }
      const hash = post.bc_store_hash || creds.storeHash
      const kind: 'blog' | 'page' = isPage ? 'page' : 'blog'

      if (action === 'unpublish') {
        await setBCContentVisibility(hash, creds.accessToken, kind, post.bc_post_id, false)
        return { applied: action, platform: 'bigcommerce', ok: true, message: 'Hidden from the BigCommerce storefront — still recoverable' }
      }

      const res = await deleteBCContent(hash, creds.accessToken, kind, post.bc_post_id)
      await clearPlatformRefs(db, postId)
      return {
        applied: action, platform: 'bigcommerce', ok: true, alreadyGone: res.alreadyGone,
        message: res.alreadyGone
          ? 'Already gone from BigCommerce — the dashboard record has been reconciled'
          : 'Deleted from BigCommerce (permanent — BigCommerce has no trash)',
      }
    }

    return { applied: action, platform: null, ok: true, message: 'Nothing published to remove' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[cmsLifecycle] action failed', action, postId, msg)
    return { applied: action, platform: post.wp_post_id ? 'wordpress' : 'bigcommerce', ok: false, message: msg }
  }
}

/**
 * Forget the CMS copy. Called after a successful delete, and by the
 * "publish as a new post" regenerate mode, which deliberately detaches the row
 * from the article it used to own.
 */
export async function clearPlatformRefs(db: Db, postId: string): Promise<void> {
  const { error } = await db
    .from('content_posts')
    .update({
      wp_post_id:        null,
      bc_post_id:        null,
      published_url:     null,
      platform_edit_url: null,
      last_pushed_at:    null,
    })
    .eq('id', postId)
  if (error) console.error('[cmsLifecycle] clearPlatformRefs failed:', error.message)
}
