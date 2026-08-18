import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminSessionEdge } from './lib/session-edge'

// Hosts allowed to make cross-origin state-changing requests to /api/admin.
// The dashboard is embedded in the GoHighLevel CRM iframe under golaunchlocal.com,
// but fetches from inside that iframe carry OUR origin; the CRM host is allowed too
// for any direct cross-origin call. Everything else is rejected (CSRF defense).
function isAllowedOrigin(originHost: string, selfHost: string | null): boolean {
  if (selfHost && originHost === selfHost) return true
  return originHost === 'golaunchlocal.com' || originHost.endsWith('.golaunchlocal.com')
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // ── CSRF guard for authenticated admin APIs ─────────────────────────────────
  // Admin cookies are SameSite=None (required for the CRM iframe), so they ride
  // cross-site requests. Reject mutating /api/admin calls whose Origin/Referer is
  // not us. Browsers always attach Origin on cross-origin POST/form submissions,
  // so a forged request is blocked; same-origin fetches pass.
  if (pathname.startsWith('/api/admin') && MUTATING_METHODS.has(request.method)) {
    const origin  = request.headers.get('origin')
    const referer = request.headers.get('referer')
    const selfHost = request.headers.get('host') ?? request.nextUrl.host
    const source = origin ?? referer
    if (source) {
      try {
        if (!isAllowedOrigin(new URL(source).host, selfHost)) {
          return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
        }
      } catch {
        return NextResponse.json({ error: 'Bad origin' }, { status: 403 })
      }
    }
    // No Origin/Referer at all: allow (non-browser server-to-server calls). The
    // cross-site browser attack always sends one, so this is not a bypass.
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

export const config = {
  matcher: ['/', '/verify', '/verify/:path*', '/dashboard/:path*', '/admin/:path*', '/api/admin/:path*'],
}
