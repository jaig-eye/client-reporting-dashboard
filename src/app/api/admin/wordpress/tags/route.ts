import { NextRequest, NextResponse } from 'next/server'
import { cookies }           from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed }     from '@/lib/auth'
import { getTags }           from '@/lib/connectors/wordpress'

/**
 * GET /api/admin/wordpress/tags?connection_id=<uuid>
 *
 * Returns the list of WordPress tags for the given WordPress client_connection.
 * Used to display existing tags alongside AI-suggested tags in ContentPostEditor.
 */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  const session     = cookieStore.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const connectionId = request.nextUrl.searchParams.get('connection_id')
  if (!connectionId) {
    return NextResponse.json({ error: 'Missing connection_id' }, { status: 400 })
  }

  const db = createAdminClient()
  const { data: conn } = await db
    .from('client_connections')
    .select('external_id, connector:connectors(auth, config)')
    .eq('id', connectionId)
    .single()

  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

  type ConnectorShape = { auth: Record<string, unknown>; config: Record<string, unknown> }
  const raw = conn.connector as unknown
  const connector: ConnectorShape | null = Array.isArray(raw) ? (raw[0] ?? null) : (raw as ConnectorShape | null)
  if (!connector) return NextResponse.json({ error: 'Connector not found' }, { status: 404 })

  const siteUrl     = String(connector.config?.site_url    || conn.external_id || '')
  const username    = String(connector.config?.username    || connector.auth?.username    || '')
  const appPassword = String(connector.config?.app_password || connector.auth?.app_password || '')

  if (!siteUrl || !username || !appPassword) {
    return NextResponse.json({ error: 'WordPress credentials incomplete' }, { status: 400 })
  }

  const tags = await getTags(siteUrl, { username, app_password: appPassword })
  return NextResponse.json({ tags })
}
