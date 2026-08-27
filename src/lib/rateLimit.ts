// ─────────────────────────────────────────────────────────────────────────────
// Per-IP rate limiting for auth endpoints.
//
// There were three hand-rolled copies of this (admin-login, forgot-password,
// reset-password) and they had already drifted in ways only a side-by-side diff
// would reveal: inverted return polarity, two counting failures while one counted
// every request, and only two carrying a cleanup sweep. One definition instead.
//
// IN-MEMORY, therefore PER SERVERLESS INSTANCE. That is a real limitation — a
// wide concurrency fan-out gives an attacker a fresh empty counter per instance —
// and it is the same limitation main has always had. The database-backed version
// on fix/security-hardening was worse in practice: it failed OPEN on any query
// error and its table was never applied, so it did nothing at all. Moving this to
// Postgres is worth doing on its own, with the migration applied first and
// failing CLOSED.
// ─────────────────────────────────────────────────────────────────────────────

import type { NextRequest } from 'next/server'

interface Entry { count: number; resetAt: number }

export interface RateLimiter {
  /**
   * Reserve one attempt. Returns false when the caller is over the limit.
   *
   * The count is incremented HERE, at check time, not after the work completes.
   * The previous shape read the counter at request entry and incremented only
   * after `await request.json()`, a user lookup and a ~0.5s bcrypt compare — so a
   * concurrent burst all observed count=0 and all proceeded, and the cap bounded
   * nothing. JavaScript's single thread makes check-and-increment in one
   * synchronous step genuinely atomic; splitting it across an await does not.
   */
  take(key: string): boolean
  /** Forget this key entirely — used after a genuine success. */
  reset(key: string): void
}

const MAX_KEYS = 5000

export function createRateLimiter({ max, windowMs }: { max: number; windowMs: number }): RateLimiter {
  const entries = new Map<string, Entry>()

  function sweep(now: number): void {
    for (const [k, v] of Array.from(entries.entries())) {
      if (now > v.resetAt) entries.delete(k)
    }
  }

  return {
    take(key: string): boolean {
      const now = Date.now()

      // Sweep BEFORE the branch, not after it. The previous version put the
      // cleanup inside the "existing entry" path, which a request from a
      // never-seen IP never reaches — so the guard meant to bound the map was
      // unreachable from precisely the case that grows it, and an attacker
      // rotating IPs could grow it without limit.
      if (entries.size > MAX_KEYS) sweep(now)

      const entry = entries.get(key)
      if (!entry || now > entry.resetAt) {
        entries.set(key, { count: 1, resetAt: now + windowMs })
        return true
      }
      if (entry.count >= max) return false
      entry.count++
      return true
    },

    reset(key: string): void {
      entries.delete(key)
    },
  }
}

/**
 * The client IP, preferring the hop the platform sets.
 *
 * x-forwarded-for is a client-supplied header that Vercel APPENDS to, so its
 * leftmost value is whatever the caller wrote. Taking that first let an attacker
 * mint a fresh bucket per request (defeating the limit) or pin a victim's bucket
 * to lock them out. x-real-ip is set by the proxy, so it comes first; the
 * RIGHTMOST forwarded-for entry is the fallback because that is the hop nearest
 * the proxy rather than the one nearest the client.
 *
 * The two auth routes previously disagreed about this order, so the same client
 * was bucketed under different keys on different endpoints.
 */
export function clientIp(request: NextRequest | Request): string {
  const h = request.headers
  const real = h.get('x-real-ip')?.trim()
  if (real) return real

  const fwd = h.get('x-forwarded-for')
  if (fwd) {
    const hops = fwd.split(',').map(s => s.trim()).filter(Boolean)
    if (hops.length > 0) return hops[hops.length - 1]
  }
  return 'unknown'
}
