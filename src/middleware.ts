import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminSessionEdge } from './lib/session-edge'

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

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

// /api/admin/* is deliberately NOT matched. Nothing above acts on it — every
// admin API route does its own isAdminAuthed() check — so matching it would add
// an Edge invocation to every admin request for no decision. (The security
// branch matched it to run a CSRF guard here; that guard is out of scope for
// this change, so the match goes with it.)
export const config = {
  matcher: ['/', '/verify', '/verify/:path*', '/dashboard/:path*', '/admin/:path*'],
}
