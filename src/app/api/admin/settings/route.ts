import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'

function isAdminAuthed(session: string | undefined) {
  return session && session === process.env.ADMIN_PASSWORD
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const [{ data, error }, { data: metaAccounts }] = await Promise.all([
    db.from('agency_settings').select('*').single(),
    db.from('ad_accounts')
      .select('available_meta_actions')
      .eq('platform', 'meta')
      .not('available_meta_actions', 'is', null),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const discoveredMetaActions = Array.from(new Set(
    (metaAccounts ?? []).flatMap(a =>
      Array.isArray(a.available_meta_actions) ? a.available_meta_actions as string[] : []
    )
  ))

  // Never expose raw tokens to the client — return status indicators only
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { meta_access_token, meta_system_user_token, ...safe } = data as Record<string, unknown>
  return NextResponse.json({
    ...safe,
    meta_connected:          !!(data as Record<string, unknown>).meta_access_token,
    meta_token_expires_at:   (data as Record<string, unknown>).meta_token_expires_at ?? null,
    discovered_meta_actions: discoveredMetaActions,
  })
}

export async function PUT(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()

  // Whitelist only editable fields — tokens are set via OAuth, never via PUT
  const allowed = [
    'agency_name', 'agency_logo_url',
    'benchmark_roas', 'benchmark_ctr', 'benchmark_cpc', 'benchmark_conv_rate', 'benchmark_cpm',
    'default_date_range_days',
    'cron_enabled',
    'metric_config',
  ]
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (body[key] !== undefined) patch[key] = body[key]
  }

  const db = createAdminClient()
  const { data: existing } = await db.from('agency_settings').select('id').single()
  if (!existing?.id) return NextResponse.json({ error: 'Settings row not found — run migration 005' }, { status: 500 })

  const { data, error } = await db
    .from('agency_settings')
    .update(patch)
    .eq('id', existing.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { meta_access_token, meta_system_user_token, ...safe } = data as Record<string, unknown>
  return NextResponse.json({
    ...safe,
    meta_connected:        !!(data as Record<string, unknown>).meta_access_token,
    meta_token_expires_at: (data as Record<string, unknown>).meta_token_expires_at ?? null,
  })
}
