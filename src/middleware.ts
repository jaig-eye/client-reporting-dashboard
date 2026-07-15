import { NextRequest, NextResponse } from 'next/server'
import { timingSafeCompare } from '@/lib/auth'

function isAdminSession(session: string | undefined): boolean {
  return timingSafeCompare(session, process.env.ADMIN_PASSWORD)
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

  // /verify — requires client_token cookie (no IP check — that's the bypass page)
  if (pathname.startsWith('/verify')) {
    const clientToken = request.cookies.get('client_token')?.value
    if (!clientToken) {
      return NextResponse.redirect(new URL('/access', request.url))
    }
    return NextResponse.next()
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
  matcher: ['/', '/verify/:path*', '/dashboard/:path*', '/admin/:path*'],
}
