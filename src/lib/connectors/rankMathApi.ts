// ─────────────────────────────────────────────────────────────────────────────
// Rank Math's own REST endpoint for writing SEO meta.
//
// I previously concluded Rank Math's REST namespace was read-only. That was wrong, and the
// correction is worth recording: `rankmath/v1/getHead` is the headless-CMS READ endpoint, and it
// is the one their documentation leads with — but `includes/rest/class-shared.php` also registers
// `rankmath/v1/updateMeta`, which writes.
//
// WHY IT IS THE RIGHT FIRST CHOICE
//
// Its permission_callback is Rest_Helper::get_object_permissions_check, which resolves to
// current_user_can( $post_type->cap->edit_post, $id ) — a capability check, with no nonce
// anywhere. An application password satisfies it, so this needs nothing installed and no extra
// credential.
//
// It also beats the XML-RPC fallback on availability: xmlrpc.php is disabled on a great many
// hosts, while this endpoint exists on any site running Rank Math.
//
// ORDER OF ATTEMPTS, on every push (the standard REST push carries the fields too, and most sites
// drop them — Rank Math does not register its keys with show_in_rest):
//
//   1. this            — Rank Math's own writer, capability-checked, no prerequisites
//   2. XML-RPC         — wp.editPost custom_fields, only when this failed for a reason other than
//                        "Rank Math is not installed", and only when the request has time left
//   3. report it       — the activity log names both failures rather than a plugin to install
//
// WordPress answering 404 `rest_no_route` means no plugin registered this route: Rank Math is not
// on the site, so there is nothing to write rank_math_* fields FOR. That comes back 'absent' and the
// caller stops — writing them over XML-RPC would re-save the post for fields nothing reads.
//
// Soft-fails throughout: any other 404, a 401/403, or any network failure returns 'failed' and the
// caller moves on. It never throws into a publish that already succeeded.
//
// The request carries the application password in its Authorization header, so it goes through
// fetchWithSiteCredentials: same-site redirects only (at most three hops), never to another host.
// It sends the same headers as every other WordPress call — BROWSER_BOT_UA included, without
// which sites behind Cloudflare or Wordfence answer 403.
// ─────────────────────────────────────────────────────────────────────────────

import { fetchWithSiteCredentials, wpHeaders } from '@/lib/connectors/wordpress'

/** Bounds the whole exchange, a followed redirect included, unless the caller asks for less. */
const RANKMATH_TIMEOUT_MS = 20_000

/**
 * What became of the write.
 *   stored — Rank Math accepted it.
 *   absent — the site has no such route: Rank Math is not installed. Nothing else should be tried.
 *   failed — anything else: refused, broken, unreachable. A fallback may be worth trying.
 */
export type RankMathWrite = 'stored' | 'absent' | 'failed'

/** The `code` of a WordPress REST error body, or '' when the body is not one. */
export function wpRestErrorCode(body: string): string {
  try {
    const parsed = JSON.parse(body) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const code = (parsed as { code?: unknown }).code
      return typeof code === 'string' ? code : ''
    }
  } catch { /* not JSON */ }
  return ''
}

/**
 * Write Rank Math meta through Rank Math's own endpoint.
 *
 * `objectType` is Rank Math's object type, which is 'post' for both posts and pages — it keys off
 * objectID, not the WordPress post type. Empty values are never sent: updateMeta DELETES a key
 * whose value is empty, and a push must not erase a field the client filled in.
 */
export async function rankMathUpdateMeta(
  siteUrl: string,
  auth: { username: string; app_password: string },
  postId: number,
  meta: Record<string, string>,
  timeoutMs: number = RANKMATH_TIMEOUT_MS,
): Promise<RankMathWrite> {
  const entries = Object.entries(meta).filter(([, v]) => typeof v === 'string' && v !== '')
  if (entries.length === 0) return 'stored'

  const url = `${siteUrl.replace(/\/+$/, '')}/wp-json/rankmath/v1/updateMeta`
  try {
    const res = await fetchWithSiteCredentials(url, {
      method:  'POST',
      headers: wpHeaders(auth, true),
      body: JSON.stringify({
        objectType: 'post',
        objectID:   postId,
        meta:       Object.fromEntries(entries),
      }),
      signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, RANKMATH_TIMEOUT_MS))),
    }, '[rank-math]')

    const body = await res.text().catch(() => '')
    if (res.ok) {
      // Rank Math answers JSON. A 200 that is not JSON came from something in front of it — a
      // security plugin's or host's challenge page — and stored nothing. The caller trusts 'stored'
      // without reading back, so this is the check that it really was Rank Math that answered.
      try { JSON.parse(body); return 'stored' } catch {
        console.warn(`[rank-math] ${siteUrl} updateMeta answered 200 with a non-JSON body: ${body.slice(0, 120)}`)
        return 'failed'
      }
    }
    if (res.status === 404 && wpRestErrorCode(body) === 'rest_no_route') {
      console.log(`[rank-math] ${siteUrl} has no rankmath/v1/updateMeta route — Rank Math is not installed there`)
      return 'absent'
    }
    console.warn(`[rank-math] ${siteUrl} updateMeta HTTP ${res.status}: ${body.slice(0, 160)}`)
    return 'failed'
  } catch (e) {
    console.warn(`[rank-math] ${siteUrl} updateMeta failed:`, String(e).slice(0, 160))
    return 'failed'
  }
}
