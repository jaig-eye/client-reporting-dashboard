import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { parseBody }   from '@/lib/apiError'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await parseBody<Record<string, unknown>>(request)
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

  const allowed = [
    'name', 'email', 'slug', 'logo_url', 'default_conversion_value', 'ad_fuel_cut',
    'lead_action', 'purchase_action',
    'benchmark_roas', 'benchmark_ctr', 'benchmark_cpc', 'benchmark_conv_rate', 'benchmark_cpm', 'benchmark_cpl',
    'show_benchmarks', 'show_blog_posts', 'hidden_metrics', 'enabled_benchmarks',
    'layout_type', 'metric_layout_override',
    'bill_day', 'historic_bill_day', 'monthly_budget', 'discord_channel_id',
    'local_dominator_url', 'stripe_customer_id',
    'ad_fuel_alert_threshold', 'ad_fuel_alert_muted',
    'auto_pause_ads', 'auto_resume_ads', 'campaigns_paused_at',
    'bc_daily_report',
    'address', 'phone', 'website', 'account_manager_id',
    'temperature', 'last_contacted_at', 'contact_stale_days',
  ]
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) patch[key] = body[key]
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('clients')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Keep content_settings.phone_number in sync with clients.phone
  if ('phone' in body) {
    const { error: phoneErr } = await db.from('content_settings')
      .upsert({ client_id: id, phone_number: body.phone ?? null }, { onConflict: 'client_id', ignoreDuplicates: false })
    if (phoneErr) console.error('[clients] phone sync to content_settings failed:', phoneErr.message)
  }

  revalidatePath(`/admin/clients/${id}`)
  revalidatePath('/admin/clients')

  const adminSession = await getAdminSession()
  logActivity(adminSession, 'updated', 'client', { resourceId: id, clientId: id, meta: { fields: Object.keys(patch) } })

  return NextResponse.json(data)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const db = createAdminClient()

  // Cascade-delete all client data manually in dependency order
  await db.from('sync_jobs').delete().eq('client_id', id)
  await db.from('client_campaign_assignments').delete().eq('client_id', id)
  await db.from('google_ads_metrics').delete().eq('client_id', id)
  await db.from('meta_ads_metrics').delete().eq('client_id', id)
  await db.from('client_connections').delete().eq('client_id', id)

  const { data: clientRow } = await db.from('clients').select('name').eq('id', id).single()
  const { error } = await db.from('clients').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  revalidatePath('/admin/clients')

  const adminSession = await getAdminSession()
  logActivity(adminSession, 'deleted', 'client', { resourceId: id, meta: { name: (clientRow as { name?: string } | null)?.name } })

  return NextResponse.json({ success: true })
}
