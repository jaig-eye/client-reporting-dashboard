import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminSessionEdge } from './lib/session-edge'
import { isSessionRevoked } from './lib/sessionRevocation'

/**
 * Cookie-authenticated, state-changing API routes that live OUTSIDE /api/admin.
 * They authenticate from the same SameSite=None admin_session cookie, so they need
 * the same CSRF and revocation treatment; scoping those guards by URL prefix alone
 * silently left them out. /api/upload is the sharper case: it reads formData, and
 * multipart/form-data is a CORS *simple* request, so it takes no preflight and a
 * hidden cross-origin form on any page an admin visits would post with the cookie
 * attached.
 *
 * Deliberately NOT included: /api/cron/*, /api/ingest/*, /api/webhooks/*. Those are
 * server-to-server, carry their own header secrets, and legitimately arrive with no
 * Origin and no admin cookie.
 */
const COOKIE_AUTHED_API_PREFIXES = ['/api/admin', '/api/upload', '/api/sync']

function isGuardedApiPath(pathname: string): boolean {
  return COOKIE_AUTHED_API_PREFIXES.some(p => pathname === p || pathname.startsWith(`${p}/`))
}

/**
 * Origins allowed to make STATE-CHANGING calls to /api/admin/*. The admin cookie is
 * SameSite=None (needed for the CRM iframe), so without this a malicious page could
 * POST to an admin route and have the browser attach the cookie. Allowed: the app's
 * own origin (same-origin fetch, including from inside the CRM iframe whose document
 * IS the app), the CRM at golaunchlocal.com, and any origin in CSRF_ALLOWED_ORIGINS.
 */
function isAllowedOrigin(origin: string, request: NextRequest): boolean {
  if (origin === request.nextUrl.origin) return true
  let host: string
  try { host = new URL(origin).hostname } catch { return false }
  if (host === 'golaunchlocal.com' || host.endsWith('.golaunchlocal.com')) return true
  const extra = process.env.CSRF_ALLOWED_ORIGINS
  if (extra) {
    for (const o of extra.split(',').map(s => s.trim()).filter(Boolean)) {
      if (origin === o) return true
    }
  }
  return false
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // CSRF defense for state-changing admin API calls. A browser ALWAYS attaches an
  // Origin header to a cross-site state-changing request, so: no Origin ⇒ not a
  // browser cross-site call (a server-to-server internal fetch with internalAdminCookie,
  // or a same-origin request) ⇒ allowed; an Origin present must be self or the CRM.
  // Read-only methods are never CSRF-sensitive and pass through untouched.
  if (isGuardedApiPath(pathname)) {
    const method = request.method
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const origin = request.headers.get('origin')
      if (origin && !isAllowedOrigin(origin, request)) {
        return new NextResponse(
          JSON.stringify({ error: 'Cross-origin request blocked' }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        )
      }
    }

    // Session revocation for the whole admin API. The handlers behind this gate on
    // the synchronous isAdminAuthed(), which verifies the HMAC and reads no row, so
    // it cannot see that an account was force-reset or deactivated — without this
    // check a stale cookie keeps working for the full 14-day TTL. Enforcing it here
    // covers all 117 route files at one call site. See lib/sessionRevocation.ts for
    // the caching and fail-open rules.
    const token = await verifyAdminSessionEdge(request.cookies.get('admin_session')?.value)
    if (token && await isSessionRevoked(token.userId, token.iat)) {
      const res = new NextResponse(
        JSON.stringify({ error: 'Session expired. Please sign in again.' }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      )
      res.cookies.delete('admin_session')
      return res
    }
    return NextResponse.next()
  }

  // Old magic-link verify path is gone — redirect to access page
  if (pathname === '/verify' || pathname.startsWith('/verify/')) {
    return NextResponse.redirect(new URL('/access', request.url))
  }

  // Site root — smart redirect based on session state
  if (pathname === '/') {
    const isAdmin     = (await verifyAdminSessionEdge(request.cookies.get('admin_session')?.value)) !== null
    const clientToken = request.cookies.get('client_token')?.value
    if (isAdmin) {
      return NextResponse.redirect(new URL('/admin/dashboard', request.url))
    }
    if (clientToken) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
    return NextResponse.redirect(new URL('/access', request.url))
  }

  // /dashboard/* — requires client_token; if admin session present without token, go to /admin
  if (pathname.startsWith('/dashboard')) {
    const token = request.cookies.get('client_token')?.value
    if (!token) {
      const isAdmin = (await verifyAdminSessionEdge(request.cookies.get('admin_session')?.value)) !== null
      if (isAdmin) {
        return NextResponse.redirect(new URL('/admin', request.url))
      }
      return NextResponse.redirect(new URL('/access', request.url))
    }
  }

  // /admin/* — login and password pages are public; everything else requires admin session
  const publicAdminPaths = ['/admin', '/admin/forgot-password', '/admin/reset-password']
  if (pathname.startsWith('/admin') && !publicAdminPaths.includes(pathname)) {
    const token = await verifyAdminSessionEdge(request.cookies.get('admin_session')?.value)
    // Revoked sessions are bounced here too, not just on the API. Otherwise a
    // force-reset or deactivated admin still renders every /admin/* page, and the
    // layout — whose getAdminSession() correctly returns null — falls through to
    // its "Super Admin" / "Master account" defaults and labels them as the master
    // account while the shell renders in full.
    const revoked = token !== null && await isSessionRevoked(token.userId, token.iat)
    if (token === null || revoked) {
      const loginUrl = new URL('/admin', request.url)
      loginUrl.searchParams.set('returnUrl', pathname + request.nextUrl.search)
      const res = NextResponse.redirect(loginUrl)
      if (revoked) res.cookies.delete('admin_session')
      return res
    }
  }

  return NextResponse.next()
}

// The API paths are matched to run the CSRF Origin guard AND the session-revocation
// check above. Neither replaces per-route authorization: every admin API route still
// does its own isAdminAuthed()/requireVerifiedAdmin() check. /api/upload and
// /api/sync are here because they authenticate from the same cookie — see
// COOKIE_AUTHED_API_PREFIXES.
export const config = {
  matcher: [
    '/', '/verify', '/verify/:path*', '/dashboard/:path*', '/admin/:path*',
    '/api/admin/:path*', '/api/upload/:path*', '/api/upload', '/api/sync/:path*',
  ],
}
