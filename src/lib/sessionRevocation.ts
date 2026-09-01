// ─────────────────────────────────────────────────────────────────────────────
// Edge-safe session revocation check.
//
// WHY THIS EXISTS
// getAdminSession() in lib/auth.ts enforces is_active and the password_changed_at
// cutoff, but it is async and does a DB read, so it is only reachable from the
// handful of routes that await it. The overwhelming majority of admin surface —
// 117 route files under src/app/api/admin gate on the SYNCHRONOUS isAdminAuthed(),
// and every /admin/* page is gated by middleware's verifyAdminSessionEdge() —
// checks the HMAC and nothing else. That left forced rotation and account
// deactivation as login-time-only controls: a stale 14-day cookie kept working
// against settings, uploads, sync triggers, billing and logs for the full TTL.
//
// A claim baked into the token cannot fix this. Revocation is state that changes
// AFTER the token is minted, so something in the request path has to consult the
// server. Middleware is the one place that already runs on every admin page and
// every admin API route, so checking here covers all of them at one call site,
// with no changes to the 117 handlers.
//
// Runs on Edge: fetch + the PostgREST endpoint directly, never @supabase/supabase-js
// or node:crypto, so the middleware bundle stays Edge-compatible.
//
// FAILURE DIRECTION
// A definite answer that the session is revoked fails CLOSED. An indeterminate one
// — Supabase unreachable, timeout, env vars absent — fails OPEN, because middleware
// sits in front of the entire admin UI and a transient database blip must not lock
// every administrator out of the product. The window this leaves is bounded by
// CACHE_TTL_MS and the request only proceeds to handlers that still do their own
// authorization; if Supabase is down, nothing behind this can serve data anyway.
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS   = 30_000   // per-instance; revocation takes effect within this
const FETCH_TIMEOUT_MS = 1500
const MAX_CACHE_KEYS = 2000

interface UserState {
  active: boolean
  /** password_changed_at as unix seconds, or null when unset/column absent. */
  changedSec: number | null
}

interface CacheEntry extends UserState { at: number }

const cache = new Map<string, CacheEntry>()

function supabaseEnv(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  return url && key ? { url: url.replace(/\/$/, ''), key } : null
}

async function fetchUserState(
  env: { url: string; key: string },
  userId: string,
): Promise<UserState | null> {
  // encodeURIComponent so a malformed userId claim cannot alter the query. The id
  // is signed, but this is one HTTP hop from a service-role credential.
  const base = `${env.url}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&limit=1&select=`

  async function get(select: string): Promise<Response | null> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    try {
      return await fetch(base + select, {
        headers: {
          apikey: env.key,
          Authorization: `Bearer ${env.key}`,
          Accept: 'application/json',
        },
        signal: ctrl.signal,
        cache: 'no-store',
      })
    } catch {
      return null   // network error / timeout → indeterminate
    } finally {
      clearTimeout(timer)
    }
  }

  // Deploy-order fallback, same as every sibling path: password_changed_at only
  // exists from migration 195, and these migrations are applied by hand, so the
  // code can reach production first. Without the retry PostgREST 400s on the
  // unknown column, this returns indeterminate, and revocation silently stops
  // being enforced with nothing in the logs.
  let res = await get('is_active,password_changed_at')
  if (res && res.status === 400) {
    console.warn('[sessionRevocation] password_changed_at missing (migration 195 not applied) — is_active only')
    res = await get('is_active')
  }
  if (!res || !res.ok) return null

  let rows: Array<{ is_active?: boolean; password_changed_at?: string | null }>
  try {
    rows = await res.json()
  } catch {
    return null
  }

  // No row means the account was deleted. That IS a definite revocation.
  if (!Array.isArray(rows) || rows.length === 0) return { active: false, changedSec: null }

  const row = rows[0]
  let changedSec: number | null = null
  if (row.password_changed_at) {
    const ms = new Date(row.password_changed_at).getTime()
    if (Number.isFinite(ms)) changedSec = Math.floor(ms / 1000)
  }
  return { active: row.is_active !== false, changedSec }
}

/**
 * True when this session must no longer be honoured: the account is inactive or
 * deleted, or the token was minted before the account's last password change
 * (self-service change, admin-set password, or a force-reset).
 *
 * Returns false — allow — whenever the answer cannot be determined. See the
 * FAILURE DIRECTION note at the top of this file.
 */
export async function isSessionRevoked(
  userId: string | undefined,
  iat: number | undefined,
): Promise<boolean> {
  // Super-admin sessions carry no userId: they authenticate against an env-var
  // password plus an emailed OTP and have no user row to revoke against.
  if (!userId) return false

  const env = supabaseEnv()
  if (!env) return false

  const now = Date.now()
  let entry = cache.get(userId)

  if (!entry || now - entry.at > CACHE_TTL_MS) {
    const fresh = await fetchUserState(env, userId)
    if (fresh) {
      if (cache.size >= MAX_CACHE_KEYS) {
        cache.forEach((v, k) => { if (now - v.at > CACHE_TTL_MS) cache.delete(k) })
        while (cache.size >= MAX_CACHE_KEYS) {
          const oldest = cache.keys().next().value
          if (oldest === undefined) break
          cache.delete(oldest)
        }
      }
      entry = { ...fresh, at: now }
      cache.set(userId, entry)
    } else if (!entry) {
      return false   // indeterminate and nothing cached → fail open
    }
    // else: indeterminate but we hold a previous answer → keep using it rather
    // than failing open, so a Supabase blip cannot un-revoke an evicted session.
  }

  if (!entry.active) return true
  if (entry.changedSec !== null && typeof iat === 'number' && iat < entry.changedSec) return true
  return false
}
