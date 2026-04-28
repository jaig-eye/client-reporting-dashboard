import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')?.value
  if (!session || session !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: clientId } = await params
  const body = await request.json()
  const { type } = body as { type: string }

  if (!type) return NextResponse.json({ error: 'type is required' }, { status: 400 })

  const db = createAdminClient()

  // Validate client exists
  const { data: client, error: clientErr } = await db
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .single()
  if (clientErr || !client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  if (type === 'ghl') {
    const { apiKey, locationId } = body as { apiKey: string; locationId: string }
    if (!apiKey || !locationId) return NextResponse.json({ error: 'apiKey and locationId are required' }, { status: 400 })

    // Upsert a connector row for this client's GHL.
    // api_key goes in auth (read by sync engine via connection.connector.auth.api_key).
    // location_id goes in config (used by discoverAccounts and for upsert conflict key).
    const { data: connector, error: connErr } = await db
      .from('connectors')
      .upsert({
        type:   'ghl',
        label:  'GoHighLevel',
        status: 'active',
        auth:   { api_key: apiKey },
        config: { location_id: locationId },
      }, { onConflict: 'type,config->location_id' })
      .select()
      .single()
    if (connErr || !connector) {
      // If upsert fails, try insert
      const { data: newConn, error: insertErr } = await db
        .from('connectors')
        .insert({ type: 'ghl', label: 'GoHighLevel', status: 'active', auth: { api_key: apiKey }, config: { location_id: locationId } })
        .select()
        .single()
      if (insertErr || !newConn) return NextResponse.json({ error: insertErr?.message ?? 'Failed to create connector' }, { status: 400 })

      const { error: linkErr } = await db.from('client_connections').insert({
        client_id:    clientId,
        connector_id: newConn.id,
        external_id:  locationId,
        external_name:'GoHighLevel',
        status:       'active',
      })
      if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 400 })
      return NextResponse.json({ ok: true })
    }

    const { error: linkErr } = await db.from('client_connections').upsert({
      client_id:    clientId,
      connector_id: connector.id,
      external_id:  locationId,
      external_name:'GoHighLevel',
      status:       'active',
    }, { onConflict: 'client_id,connector_id' })
    if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 400 })
    return NextResponse.json({ ok: true })

  } else if (type === 'wordpress') {
    const { siteUrl, username, appPassword } = body as { siteUrl: string; username: string; appPassword: string }
    if (!siteUrl || !username || !appPassword) return NextResponse.json({ error: 'siteUrl, username, and appPassword are required' }, { status: 400 })

    const normalizedUrl = siteUrl.replace(/\/$/, '')

    const { data: newConn, error: insertErr } = await db
      .from('connectors')
      .insert({
        type:   'wordpress',
        label:  `WordPress — ${normalizedUrl}`,
        status: 'active',
        config: { site_url: normalizedUrl, username, app_password: appPassword },
      })
      .select()
      .single()
    if (insertErr || !newConn) return NextResponse.json({ error: insertErr?.message ?? 'Failed to create connector' }, { status: 400 })

    const { error: linkErr } = await db.from('client_connections').insert({
      client_id:    clientId,
      connector_id: newConn.id,
      external_id:  normalizedUrl,
      external_name: normalizedUrl,
      status:       'active',
    })
    if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 400 })
    return NextResponse.json({ ok: true })

  } else {
    return NextResponse.json({ error: `Unsupported type: ${type}` }, { status: 400 })
  }
}
