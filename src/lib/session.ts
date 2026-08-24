// ─────────────────────────────────────────────────────────────────────────────
// Signed admin session tokens (Node runtime).
//
// The `admin_session` cookie used to hold the raw ADMIN_PASSWORD, and identity
// (super-admin vs regular, which user) was derived from the UNSIGNED `admin_user_id`
// cookie — both client-editable. That allowed privilege escalation (delete
// admin_user_id → super-admin) and impersonation (set it to another id).
//
// Now `admin_session` holds an HMAC-signed token that carries the identity claims.
// Tampering with the payload invalidates the signature, so the server no longer
// trusts the client for authorization.
//
// Edge (middleware) verification lives in `session-edge.ts` — it must NOT import
// node:crypto, so the two runtimes have separate, format-compatible implementations.
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac, timingSafeEqual } from 'crypto'

export interface AdminSessionClaims {
  isSuperAdmin: boolean
  userId?: string
  role?: string
}

export interface AdminSessionToken extends AdminSessionClaims {
  v: 1
  iat: number   // issued-at (unix seconds)
  exp: number   // expiry    (unix seconds)
}

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14   // 14 days — matches cookie maxAge

/**
 * HMAC key.
 *
 * ⚠️ SET A DEDICATED `SESSION_SECRET` IN PRODUCTION. The ADMIN_PASSWORD fallback exists only
 * so the feature works without a new env var, but it is NOT safe long-term: until this change
 * shipped, `admin_session` literally WAS the raw ADMIN_PASSWORD and was sent on every admin
 * request — so that value may sit in HAR exports, proxy/WAF logs, Vercel request logs and
 * support screenshots. Anyone holding an old cookie value could use it as the signing key to
 * forge `{ isSuperAdmin: true }` and bypass both the password and the OTP. Generate one with
 * `openssl rand -hex 32` and set it BEFORE deploying.
 */
function sessionSecret(): string {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || ''
}

function hmac(body: string): string {
  return createHmac('sha256', sessionSecret()).update(body).digest('base64url')
}

/** Sign a session token (Node). */
export function signAdminSession(claims: AdminSessionClaims): string {
  // Both verifiers return null on an empty secret, so signing with one would mint a cookie
  // that can never verify — login returns 200, middleware bounces back to /admin, and the
  // admin is stuck in a silent redirect loop with no error anywhere. Fail loudly instead.
  if (!sessionSecret()) {
    throw new Error('[session] Cannot sign admin session: set SESSION_SECRET (or ADMIN_PASSWORD).')
  }
  const nowSec = Math.floor(Date.now() / 1000)
  const payload: AdminSessionToken = {
    v: 1,
    isSuperAdmin: claims.isSuperAdmin,
    ...(claims.userId ? { userId: claims.userId } : {}),
    ...(claims.role ? { role: claims.role } : {}),
    iat: nowSec,
    exp: nowSec + SESSION_TTL_SECONDS,
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${hmac(body)}`
}

/**
 * Cookie header value for INTERNAL server-to-server calls that need to authenticate as
 * admin (cron jobs and admin routes that fetch our own /api/admin endpoints).
 *
 * These previously sent the raw ADMIN_PASSWORD as the cookie value, which only worked while
 * `admin_session` WAS the password. Now that the cookie holds a signed token, they must mint
 * a real one — otherwise every internal call 401s. Server-side fetches send no Origin header,
 * so the middleware CSRF guard allows them.
 */
export function internalAdminCookie(): string {
  return `admin_session=${signAdminSession({ isSuperAdmin: true })}`
}

/** Verify + decode a session token (Node, synchronous). Returns null when invalid/expired. */
export function verifyAdminSessionNode(token: string | undefined | null): AdminSessionToken | null {
  if (!token || !sessionSecret()) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const sig  = token.slice(dot + 1)
  const expected = hmac(body)

  const sigBuf = Buffer.from(sig)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AdminSessionToken
    if (!payload || payload.v !== 1) return null
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}
