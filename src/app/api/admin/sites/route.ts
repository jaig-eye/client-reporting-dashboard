import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { isAdminAuthed } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const db = createAdminClient()

  let query = db
    .from('sites')
    .select('id, name, url, platform, hosting_type, hosting_provider, server_account, status, notes, is_up, last_checked_at, last_status_code, last_response_ms, uptime_7d, ssl_days_remaining, ssl_expires_at, ssl_last_checked, consecutive_failures, client_id, group_id, created_at, updated_at, clients(id, name), site_groups(id, name)')
    .order('name')

  const status = searchParams.get('status')
  if (status) query = query.eq('status', status)

  const platform = searchParams.get('platform')
  if (platform) query = query.eq('platform', platform)

  const hostingType = searchParams.get('hosting_type')
  if (hostingType) query = query.eq('hosting_type', hostingType)

  const groupId = searchParams.get('group_id')
  if (groupId) query = query.eq('group_id', groupId)

  const isUp = searchParams.get('is_up')
  if (isUp === 'true') query = query.eq('is_up', true)
  if (isUp === 'false') query = query.eq('is_up', false)

  const q = searchParams.get('q')
  if (q) {
    // Strip PostgREST filter metacharacters before interpolation into or()
    const safeQ = q.replace(/[,()]/g, '')
    query = query.or(`name.ilike.%${safeQ}%,url.ilike.%${safeQ}%`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Two-step GSC URL lookup: first get GSC connector IDs, then get their client connections.
  // Direct embedded-filter (.eq('connectors.type', ...)) on a PostgREST join is ambiguous
  // across client versions and can silently return all connections unfiltered.
  const [{ data: groups }, { data: wpSites }, { data: gscConnectors }] = await Promise.all([
    db.from('site_groups').select('id, name').order('name'),
    // wp_sites gives us WordPress URLs per client for the "suggest URL" feature
    db.from('wp_sites').select('client_id, site_url'),
    // Step 1: IDs of all GSC connectors in this agency account
    db.from('connectors').select('id').eq('type', 'google_search_console'),
  ])

  // Step 2: active connections for those connector IDs → external_id is the GSC property URL
  const gscConnectorIds = (gscConnectors ?? []).map((c: { id: string }) => c.id)
  const gscConnsRes = gscConnectorIds.length > 0
    ? await db.from('client_connections')
        .select('client_id, external_id')
        .in('connector_id', gscConnectorIds)
        .eq('status', 'active')
    : { data: [], error: null }

  if (gscConnsRes.error) {
    console.error('GSC connections query failed:', gscConnsRes.error)
  }

  const gscUrls = (gscConnsRes.data ?? []).map((c: { client_id: string; external_id: string }) => ({
    client_id: c.client_id,
    url:       c.external_id,
  }))

  return NextResponse.json({ sites: data ?? [], groups: groups ?? [], wpSites: wpSites ?? [], gscUrls })
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { name, url, client_id, platform, hosting_type, hosting_provider, server_account, group_id, notes, discord_channel_id } = body

  if (!name || !url) {
    return NextResponse.json({ error: 'name and url are required' }, { status: 400 })
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('sites')
    .insert({
      name, url,
      client_id:          client_id          || null,
      platform:           platform           || 'custom',
      hosting_type:       hosting_type       || 'client',
      hosting_provider:   hosting_provider   || null,
      server_account:     server_account     || null,
      group_id:           group_id           || null,
      notes:              notes              || null,
      discord_channel_id: discord_channel_id || null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ site: data }, { status: 201 })
}
