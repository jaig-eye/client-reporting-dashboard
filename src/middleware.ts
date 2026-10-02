import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminSessionEdge } from './lib/session-edge'
import { isSessionRevoked, isReadOnlyViewer } from './lib/sessionRevocation'
import { clearCookie } from './lib/clearSession'

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
 * The only changes a read-only viewer may make: their own profile and password, and the post
 * editor's link check, which reads the links and writes nothing. Everything else that isn't a
 * read is refused below, at one call site, because most routes gate on isAdminAuthed() alone
 * (a signature check that never looks at the role) and only a handful used requireWriteAdmin():
 * a viewer could edit, approve and publish posts, change schedules and run AI generation.
 */
const VIEWER_WRITABLE = [
  /^\/api\/admin\/users\/me(\/password)?$/,
  /^\/api\/admin\/content\/posts\/[^/]+\/scan-links$/,
]

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
      clearCookie(res, 'admin_session')
      return res
    }
    // Read-only viewers can look but not change anything (see VIEWER_WRITABLE).
    if (
      token && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
      && isReadOnlyViewer(token.userId, token.role)
      && !VIEWER_WRITABLE.some(re => re.test(pathname))
    ) {
      return new NextResponse(
        JSON.stringify({ error: 'Your account is read-only, so it can’t make changes. Ask an admin.' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      )
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
    // Nobody signed in and no dashboard link: the main URL is the agency's front door, so it
    // opens the login. /access ("link expired or invalid") is for a client whose dashboard link
    // failed, and /dashboard without a link still goes there.
    return NextResponse.redirect(new URL('/admin', request.url))
  }

  // /dashboard/* — requires client_token; if admin session present without token, go to /admin
  if (pathname.startsWith('/dashboard')) {
    const token = request.cookies.get('client_token')?.value
    const admin = await verifyAdminSessionEdge(request.cookies.get('admin_session')?.value)

    // Revocation has to be checked HERE too, not only on /admin and /api/admin.
    // dashboard/layout.tsx and actions/rawMode.ts both gate the admin bar on
    // isAdminAuthed(), which verifies the HMAC and reads no row — so without this a
    // revoked admin still gets an elevated view of any client dashboard for the full
    // 14-day cookie TTL. Strip the cookie and let them continue as a plain client
    // session if they hold a client_token; the page then renders with no admin bar.
    const revoked = admin !== null && await isSessionRevoked(admin.userId, admin.iat)

    if (!token) {
      if (admin !== null && !revoked) {
        return NextResponse.redirect(new URL('/admin', request.url))
      }
      const res = NextResponse.redirect(new URL('/access', request.url))
      if (revoked) clearCookie(res, 'admin_session')
      return res
    }

    if (revoked) {
      // Strip it from the REQUEST, not just the response. Clearing it on the response
      // alone is too late: this same request still renders, and layout.tsx reads
      // cookies() off the request, so the admin bar would paint one final time. A
      // redirect-to-self would avoid that but risks a loop if the clearing header is
      // ever dropped; rewriting the header cannot loop.
      request.cookies.delete('admin_session')
      const res = NextResponse.next({ request: { headers: request.headers } })
      return clearCookie(res, 'admin_session')
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
      if (revoked) clearCookie(res, 'admin_session')
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
