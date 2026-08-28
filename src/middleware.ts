import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminSessionEdge } from './lib/session-edge'

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
  if (pathname.startsWith('/api/admin')) {
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
    const isAdmin = (await verifyAdminSessionEdge(request.cookies.get('admin_session')?.value)) !== null
    if (!isAdmin) {
      const loginUrl = new URL('/admin', request.url)
      loginUrl.searchParams.set('returnUrl', pathname + request.nextUrl.search)
      return NextResponse.redirect(loginUrl)
    }
  }

  return NextResponse.next()
}

// /api/admin/* is matched ONLY to run the CSRF Origin guard above (a real
// decision); it does not do session verification here — every admin API route
// still does its own isAdminAuthed()/requireVerifiedAdmin() check.
export const config = {
  matcher: ['/', '/verify', '/verify/:path*', '/dashboard/:path*', '/admin/:path*', '/api/admin/:path*'],
}
