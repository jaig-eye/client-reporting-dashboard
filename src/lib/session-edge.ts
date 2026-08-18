// ─────────────────────────────────────────────────────────────────────────────
// Signed admin session verification for the Edge runtime (middleware).
//
// Format-compatible with `session.ts` (Node) but implemented with Web Crypto so it
// never imports node:crypto — importing node:crypto into middleware previously made
// it throw internally and reject every valid session. Middleware only needs to know
// whether the token is a valid, unexpired admin session; it does not need the claims.
// ─────────────────────────────────────────────────────────────────────────────

interface EdgeSessionPayload {
  v: number
  isSuperAdmin?: boolean
  userId?: string
  exp?: number
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlToString(b64url: string): string {
  const pad  = b64url.length % 4 === 0 ? '' : '='.repeat(4 - (b64url.length % 4))
  const norm = b64url.replace(/-/g, '+').replace(/_/g, '/') + pad
  return atob(norm)
}

/** Constant-time-ish string compare (both strings are attacker-influenced HMACs of equal expected length). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Verify a session token on the Edge runtime. Returns the payload, or null if invalid/expired. */
export async function verifyAdminSessionEdge(
  token: string | undefined | null,
): Promise<EdgeSessionPayload | null> {
  const secret = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || ''
  if (!token || !secret) return null

  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const sig  = token.slice(dot + 1)

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
    const expected = bytesToB64url(new Uint8Array(mac))
    if (!safeEqual(sig, expected)) return null

    const payload = JSON.parse(b64urlToString(body)) as EdgeSessionPayload
    if (!payload || payload.v !== 1) return null
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}
