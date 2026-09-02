import { NextRequest, NextResponse } from 'next/server'
import { cookies }           from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, requireWriteAdmin, getAdminSession } from '@/lib/auth'
import { logActivity }      from '@/lib/activity'
import { getCategories, createCategory } from '@/lib/connectors/wordpress'

/**
 * GET /api/admin/wordpress/categories?connection_id=<uuid>
 *
 * Returns the list of WordPress categories for the given client_connection.
 * Used to populate the category multi-select in the schedule config and post editor.
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
    .maybeSingle()

  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

  type ConnectorShape = { auth: Record<string, unknown>; config: Record<string, unknown> }
  const raw = conn.connector as unknown
  const connector: ConnectorShape | null = Array.isArray(raw) ? (raw[0] ?? null) : (raw as ConnectorShape | null)
  if (!connector) return NextResponse.json({ error: 'Connector not found' }, { status: 404 })

  const siteUrl     = String(connector.config?.site_url     || conn.external_id || '')
  const username    = String(connector.config?.username     || connector.auth?.username     || '')
  const appPassword = String(connector.config?.app_password || connector.auth?.app_password || '')

  if (!siteUrl || !username || !appPassword) {
    return NextResponse.json({ error: 'WordPress credentials incomplete' }, { status: 400 })
  }

  const categories = await getCategories(siteUrl, { username, app_password: appPassword })
  return NextResponse.json({ categories })
}

/**
 * POST /api/admin/wordpress/categories
 * Body: { connection_id: string, name: string }
 *
 * Creates a category on the client's WordPress site and returns it, so a reviewer can add
 * one from the post editor instead of leaving for wp-admin, creating it there, and coming
 * back to re-open the post.
 *
 * requireWriteAdmin, not isAdminAuthed: this writes to the client's LIVE site, which a
 * read-only viewer should not be able to do. The GET above stays on isAdminAuthed,
 * because listing categories is harmless.
 */
export async function POST(request: NextRequest) {
  const gate = await requireWriteAdmin()
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const body = await request.json().catch(() => ({})) as { connection_id?: string; name?: string }
  const connectionId = body.connection_id
  const name = (body.name ?? '').trim()

  if (!connectionId)   return NextResponse.json({ error: 'Missing connection_id' }, { status: 400 })
  if (name.length < 2) return NextResponse.json({ error: 'Category name must be at least 2 characters' }, { status: 400 })
  if (name.length > 200) return NextResponse.json({ error: 'Category name is too long' }, { status: 400 })

  const db = createAdminClient()
  const { data: conn } = await db
    .from('client_connections')
    .select('external_id, connector:connectors(auth, config)')
    .eq('id', connectionId)
    .maybeSingle()

  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

  type ConnectorShape = { auth: Record<string, unknown>; config: Record<string, unknown> }
  const rawConnector = conn.connector as unknown
  const connector: ConnectorShape | null = Array.isArray(rawConnector)
    ? (rawConnector[0] ?? null)
    : (rawConnector as ConnectorShape | null)
  if (!connector) return NextResponse.json({ error: 'Connector not found' }, { status: 404 })

  const site = String(connector.config?.site_url     || conn.external_id || '')
  const user = String(connector.config?.username     || connector.auth?.username     || '')
  const pass = String(connector.config?.app_password || connector.auth?.app_password || '')

  if (!site || !user || !pass) {
    return NextResponse.json({ error: 'WordPress credentials incomplete' }, { status: 400 })
  }

  try {
    const auth = { username: user, app_password: pass }
    let category = await createCategory(site, auth, name)

    // createCategory returns null when WordPress rejects a duplicate. That is a success
    // from the reviewer's point of view — they want the category available to select, and
    // it already is — so resolve it to the existing term instead of erroring, which would
    // otherwise push them to invent a near-duplicate name.
    let existed = false
    if (!category) {
      const all = await getCategories(site, auth)
      const match = all.find(c => c.name.trim().toLowerCase() === name.toLowerCase())
      if (!match) {
        return NextResponse.json(
          { error: 'WordPress reported that category already exists, but it could not be found. Try Refresh.' },
          { status: 409 },
        )
      }
      category = match
      existed  = true
    }

    const adminSession = await getAdminSession()
    logActivity(adminSession, 'created', 'wordpress_category', {
      meta: { name: category.name, categoryId: category.id, existed, site },
    })
    return NextResponse.json({ category, existed })
  } catch (e) {
    // WordPress's own message is far more useful than a generic failure — it says things
    // like "Sorry, you are not allowed to create terms", which names exactly the
    // permission the application password is missing.
    const message = e instanceof Error ? e.message : String(e)
    console.error('[wordpress/categories] create failed:', message)
    return NextResponse.json(
      { error: `WordPress rejected the category: ${message.slice(0, 300)}` },
      { status: 502 },
    )
  }
}
