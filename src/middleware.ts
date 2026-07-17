import { NextRequest, NextResponse } from 'next/server'

// Constant-time string compare, implemented without Node's `crypto` module.
// Middleware always runs on the Edge Runtime in Next.js 14 (no nodejs runtime
// opt-out), where Node's crypto.timingSafeEqual/Buffer are not reliably
// available — importing it here previously made isAdminSession() always
// throw internally and fall back to `false`, permanently rejecting every
// valid admin session.
function isAdminSession(session: string | undefined): boolean {
  const expected = process.env.ADMIN_PASSWORD
  if (!session || !expected || session.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < session.length; i++) {
    diff |= session.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Site root — smart redirect based on session state
  if (pathname === '/') {
    const adminSession = request.cookies.get('admin_session')?.value
    const clientToken  = request.cookies.get('client_token')?.value
    if (isAdminSession(adminSession)) {
      return NextResponse.redirect(new URL('/admin/dashboard', request.url))
    }
    if (clientToken) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
    return NextResponse.redirect(new URL('/access', request.url))
  }

  // /dashboard/* — requires client_token; if admin session present without token, go to /admin
  if (pathname.startsWith('/dashboard')) {
    const token        = request.cookies.get('client_token')?.value
    const adminSession = request.cookies.get('admin_session')?.value
    if (!token) {
      if (isAdminSession(adminSession)) {
        return NextResponse.redirect(new URL('/admin', request.url))
      }
      return NextResponse.redirect(new URL('/access', request.url))
    }
  }

  // /admin/* — login and password pages are public; everything else requires admin session
  const publicAdminPaths = ['/admin', '/admin/forgot-password', '/admin/reset-password']
  if (pathname.startsWith('/admin') && !publicAdminPaths.includes(pathname)) {
    const session = request.cookies.get('admin_session')?.value
    if (!isAdminSession(session)) {
      const loginUrl = new URL('/admin', request.url)
      loginUrl.searchParams.set('returnUrl', pathname + request.nextUrl.search)
      return NextResponse.redirect(loginUrl)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/', '/dashboard/:path*', '/admin/:path*'],
}
