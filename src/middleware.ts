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

  // Protect /admin — requires admin_session cookie
  if (pathname.startsWith('/admin') && pathname !== '/admin/login') {
    const session = request.cookies.get('admin_session')?.value
    if (!session || session !== process.env.ADMIN_PASSWORD) {
      return NextResponse.redirect(new URL('/admin/login', request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*'],
}
