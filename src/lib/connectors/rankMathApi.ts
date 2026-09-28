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
// hosts, while this endpoint exists on any site running Rank Math — and if we are writing
// rank_math_* fields at all, Rank Math is running by definition.
//
// ORDER OF ATTEMPTS, once a read-back shows the standard REST push dropped a field:
//
//   1. this            — Rank Math's own writer, capability-checked, no prerequisites
//   2. XML-RPC         — wp.editPost custom_fields, when xmlrpc.php is open
//   3. report it       — the activity log names both failures rather than a plugin to install
//
// Soft-fails throughout: a 404 (older Rank Math), a 401, or any network failure returns false and
// the caller moves on. It never throws into a publish that already succeeded.
// ─────────────────────────────────────────────────────────────────────────────

const RANKMATH_TIMEOUT_MS = 20_000

function authHeader(username: string, appPassword: string): string {
  return 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64')
}

/**
 * Write Rank Math meta through Rank Math's own endpoint.
 *
 * `postType` is Rank Math's object type, which is 'post' for both posts and pages — it keys off
 * objectID, not the WordPress post type.
 */
export async function rankMathUpdateMeta(
  siteUrl: string,
  auth: { username: string; app_password: string },
  postId: number,
  meta: Record<string, string>,
): Promise<boolean> {
  const entries = Object.entries(meta).filter(([, v]) => typeof v === 'string' && v !== '')
  if (entries.length === 0) return true

  const url = `${siteUrl.replace(/\/+$/, '')}/wp-json/rankmath/v1/updateMeta`
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        Authorization:  authHeader(auth.username, auth.app_password),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        objectType: 'post',
        objectID:   postId,
        meta:       Object.fromEntries(entries),
      }),
      signal: AbortSignal.timeout(RANKMATH_TIMEOUT_MS),
    })

    if (res.status === 404) {
      // Rank Math not installed, or a version predating this route.
      console.warn(`[rank-math] ${siteUrl} has no updateMeta route`)
      return false
    }
    if (!res.ok) {
      const body = await res.text()
      console.warn(`[rank-math] ${siteUrl} updateMeta HTTP ${res.status}: ${body.slice(0, 160)}`)
      return false
    }
    return true
  } catch (e) {
    console.warn(`[rank-math] ${siteUrl} updateMeta failed:`, String(e).slice(0, 160))
    return false
  }
}
