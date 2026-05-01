import { NextRequest, NextResponse } from 'next/server'

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Protect /dashboard — requires client_token cookie
  if (pathname.startsWith('/dashboard')) {
    const token = request.cookies.get('client_token')?.value
    if (!token) {
      return NextResponse.redirect(new URL('/access', request.url))
    }
    // Token is validated in the page itself against the DB
  }

  // Protect /admin/* — /admin itself is the login page (unauthenticated access allowed)
  if (pathname.startsWith('/admin') && pathname !== '/admin') {
    const session = request.cookies.get('admin_session')?.value
    if (!session || session !== process.env.ADMIN_PASSWORD) {
      const loginUrl = new URL('/admin', request.url)
      loginUrl.searchParams.set('returnUrl', pathname + request.nextUrl.search)
      return NextResponse.redirect(loginUrl)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*'],
}
