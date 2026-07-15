import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { logActivity } from '@/lib/activity'

// GET — navigating to /api/admin/preview/[clientId] sets the cookie and redirects to the preview page.
// Used by health card "Preview" links so cookies() is called in a Route Handler, not a Server Component.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.redirect(new URL('/admin/login', req.url))
  }

  const { clientId } = await params
  const db = createAdminClient()
  const { data: client } = await db
    .from('clients')
    .select('dashboard_token, name')
    .eq('id', clientId)
    .single()

  if (!client?.dashboard_token) {
    return NextResponse.redirect(new URL('/admin', req.url))
  }

  const adminSession = await getAdminSession()
  logActivity(adminSession, 'previewed', 'client', {
    clientId,
    clientName: (client as unknown as { name?: string }).name,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
  })

  const res = NextResponse.redirect(new URL(`/dashboard`, req.url))
  res.cookies.set('client_token', client.dashboard_token, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 8,
  })
  return res
}

// POST — used by PreviewClientSwitcher to switch clients without a full page reload.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { clientId } = await params
  const db = createAdminClient()
  const { data: client } = await db
    .from('clients')
    .select('dashboard_token, name')
    .eq('id', clientId)
    .single()

  if (!client?.dashboard_token) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const adminSession = await getAdminSession()
  logActivity(adminSession, 'previewed', 'client', {
    clientId,
    clientName: (client as unknown as { name?: string }).name,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
  })

  const res = NextResponse.json({ ok: true })
  res.cookies.set('client_token', client.dashboard_token, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 8,
  })
  return res
}
