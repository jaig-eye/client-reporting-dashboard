// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting for auth endpoints.
//
// Two-tier by design:
//   1. Upstash Redis (shared across all serverless instances) WHEN configured —
//      reads UPSTASH_REDIS_REST_URL/TOKEN or the KV_REST_API_URL/TOKEN pair the
//      Vercel Marketplace "Upstash Redis" integration injects. This closes the
//      distributed / instance-fan-out bypass the in-memory version cannot.
//   2. In-memory per-instance fallback WHENEVER Upstash is absent OR a Redis call
//      errors/times out. So with no integration configured the behaviour is
//      exactly as before, and a Redis hiccup can never lock a real admin out — it
//      silently degrades to the local limiter rather than failing the request.
//
// take()/reset() are async because the Redis path is a network call. The Redis
// counter uses INCR + PEXPIRE, which is atomic server-side, so concurrent bursts
// are counted correctly across instances.
// ─────────────────────────────────────────────────────────────────────────────

import type { NextRequest } from 'next/server'

interface Entry { count: number; resetAt: number }

export interface RateLimiter {
  /** Reserve one attempt. Returns false when the caller is over the limit. */
  take(key: string): Promise<boolean>
  /** Forget this key entirely — used after a genuine success. */
  reset(key: string): Promise<void>
}

const MAX_KEYS = 5000
const REDIS_TIMEOUT_MS = 1500

function upstashEnv(): { url: string; token: string } | null {
  // Accept BOTH the native Upstash names and the KV_* names the Vercel Marketplace
  // "Upstash Redis" integration injects — they point at the same Upstash REST
  // endpoint and full-access (read/write) token. KV_REST_API_TOKEN, not the
  // READ_ONLY one, because the limiter needs INCR.
  const url   = process.env.UPSTASH_REDIS_REST_URL   || process.env.KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
  return url && token ? { url: url.replace(/\/$/, ''), token } : null
}

/** POST a Redis command pipeline to Upstash's REST API, with a hard timeout. */
async function upstashPipeline(
  env: { url: string; token: string },
  commands: (string | number)[][],
): Promise<Array<{ result?: unknown; error?: unknown }> | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REDIS_TIMEOUT_MS)
  try {
    const res = await fetch(`${env.url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
      signal: ctrl.signal,
      cache: 'no-store',
    })
    if (!res.ok) return null
    return await res.json() as Array<{ result?: unknown; error?: unknown }>
  } catch {
    return null   // network error / timeout → caller falls back to in-memory
  } finally {
    clearTimeout(timer)
  }
}

export function createRateLimiter(
  { name, max, windowMs }: { name: string; max: number; windowMs: number },
): RateLimiter {
  const entries = new Map<string, Entry>()

  // forEach avoids the Array.from copy of the whole map; deleting during
  // Map.forEach is safe and needs no downlevelIteration.
  function sweep(now: number): void {
    entries.forEach((v, k) => { if (now > v.resetAt) entries.delete(k) })
  }

  // ── In-memory fallback (unchanged fixed-window with a hard key cap) ──────────
  function memTake(key: string): boolean {
    const now = Date.now()
    const entry = entries.get(key)
    if (entry && now <= entry.resetAt) {
      if (entry.count >= max) return false
      entry.count++
      return true
    }
    // New/expired key — enforce a real hard cap so an IP-rotation flood cannot
    // grow the map without bound: reclaim expired entries, then evict oldest.
    if (entries.size >= MAX_KEYS) {
      sweep(now)
      while (entries.size >= MAX_KEYS) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        entries.delete(oldest)
      }
    }
    entries.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  function memReset(key: string): void { entries.delete(key) }

  const redisKey = (key: string) => `rl:${name}:${key}`

  return {
    async take(key: string): Promise<boolean> {
      const env = upstashEnv()
      if (env) {
        // INCR the counter and (re)assert the window TTL. Unconditional PEXPIRE
        // avoids depending on the PEXPIRE ... NX flag and can never leave a key
        // without an expiry; a continuously-attacking key simply stays blocked
        // until it goes quiet for windowMs.
        const rk = redisKey(key)
        const out = await upstashPipeline(env, [['INCR', rk], ['PEXPIRE', rk, windowMs]])
        const count = out?.[0]?.result
        if (typeof count === 'number') return count <= max
        // else: Redis errored/timed out → fall through to in-memory.
      }
      return memTake(key)
    },

    async reset(key: string): Promise<void> {
      memReset(key)   // always clear the local counter immediately
      const env = upstashEnv()
      if (env) await upstashPipeline(env, [['DEL', redisKey(key)]])
    },
  }
}

/**
 * The client IP, preferring the hop the platform sets.
 *
 * x-forwarded-for is client-supplied and Vercel APPENDS to it, so its leftmost
 * value is attacker-written. x-real-ip is set by the proxy; the RIGHTMOST
 * forwarded-for entry is the fallback (nearest the proxy, not the client).
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
