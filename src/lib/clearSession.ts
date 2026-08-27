import type { NextResponse } from 'next/server'

/**
 * Clear every session cookie on a response.
 *
 * The delete attributes MUST mirror how the cookies were SET (admin-login's COOKIE_OPTS
 * and the access route both use secure + sameSite:'none' in production, because the app
 * is framed cross-origin inside the CRM). A Set-Cookie without SameSite=None; Secure is
 * rejected outright in a third-party context — so a plain `{ maxAge: 0, path: '/' }`
 * deletion silently does nothing inside the iframe: the request returns ok, the UI
 * redirects, and the session survives. That is exactly the shared-machine case logout
 * exists to handle.
 */
const ADMIN_COOKIES  = ['admin_session', 'admin_user_id', 'admin_raw_mode'] as const
const CLIENT_COOKIES = ['client_token'] as const

/** Expire one cookie with attributes that mirror how it was SET. */
export function clearCookie(res: NextResponse, name: string): NextResponse {
  const isProd = process.env.NODE_ENV === 'production'
  res.cookies.set(name, '', {
    httpOnly: true,
    secure:   isProd,
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    maxAge:   0,
    path:     '/',
  })
  return res
}

/**
 * Clear cookies by SCOPE, not all of them unconditionally.
 *
 * The single all-cookies helper widened two endpoints past what they used to do:
 * /api/auth/signout previously dropped only client_token, so an admin who entered
 * a client dashboard via preview and hit client sign-out would have lost their
 * admin session too. Scope keeps each endpoint doing its own job.
 */
export function clearSessionCookies(
  res: NextResponse,
  scope: 'admin' | 'client' | 'all' = 'all',
): NextResponse {
  const names =
    scope === 'admin'  ? ADMIN_COOKIES
    : scope === 'client' ? CLIENT_COOKIES
    : [...ADMIN_COOKIES, ...CLIENT_COOKIES]
  for (const name of names) clearCookie(res, name)
  return res
}
