import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import { publishPost } from '@/lib/connectors/wordpress'

export async function POST(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { connection_id, title, content, status = 'draft' } = body

  if (!connection_id || !title || !content) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const db = createAdminClient()

  // Get the connection with its connector auth/config
  const { data: conn } = await db
    .from('client_connections')
    .select('*, connector:connectors!inner(auth, config)')
    .eq('id', connection_id)
    .single()

  if (!conn) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  }

  const connector = conn.connector as { auth: Record<string, unknown>; config: Record<string, unknown> }
  const siteUrl     = String(connector.config.site_url || conn.external_id || '')
  const username    = String(connector.config.username    || connector.auth.username    || '')
  const appPassword = String(connector.config.app_password || connector.auth.app_password || '')

  if (!siteUrl || !username || !appPassword) {
    return NextResponse.json({ error: 'WordPress credentials incomplete' }, { status: 400 })
  }

  try {
    const result = await publishPost(
      siteUrl,
      { username, app_password: appPassword },
      { title, content, status: status as 'draft' | 'publish' }
    )
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
