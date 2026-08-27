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
const SESSION_COOKIES = ['admin_session', 'admin_user_id', 'client_token', 'admin_raw_mode'] as const

export function clearSessionCookies(res: NextResponse): NextResponse {
  const isProd = process.env.NODE_ENV === 'production'
  for (const name of SESSION_COOKIES) {
    res.cookies.set(name, '', {
      httpOnly: true,
      secure:   isProd,
      sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
      maxAge:   0,
      path:     '/',
    })
  }
  return res
}
