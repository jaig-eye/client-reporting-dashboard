import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { getAdminSession, timingSafeCompare } from '@/lib/auth'
import { logActivity }     from '@/lib/activity'
import { parseBody }       from '@/lib/apiError'

function isAdminAuthed(session: string | undefined) {
  return timingSafeCompare(session, process.env.ADMIN_PASSWORD)
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const { data, error } = await db.from('agency_settings').select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PUT(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await parseBody<Record<string, unknown>>(request)
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

  const allowed = [
    'agency_name', 'agency_logo_url', 'favicon_url',
    'benchmark_roas', 'benchmark_ctr', 'benchmark_cpc', 'benchmark_conv_rate', 'benchmark_cpm',
    'default_date_range_days', 'default_conversion_value',
    'ad_fuel_cut',
    'cron_enabled',
    'default_lead_action', 'default_lead_action_fallback',
    'default_purchase_action', 'default_purchase_action_fallback',
    'ai_provider', 'ai_model', 'ai_api_key', 'openai_api_key',
    'chart_color_spend', 'chart_color_prior_spend',
    'chart_color_conversions', 'chart_color_prior_conversions',
    'notification_email',
    'notify_topics_created', 'notify_post_generated', 'notify_sa_generated', 'notify_approval_needed',
    'notify_schedule_generated',
    'notify_post_uploaded', 'notify_topic_ready',
    'notify_metric_alerts', 'notify_connector_errors', 'metric_alert_threshold', 'daily_alert_threshold',
    'daily_alert_metrics', 'weekly_alert_metrics',
    'overview_columns',
    'sync_frequency', 'sync_hour_utc', 'sync_day_of_week',
    'metric_layouts',
    'hidden_connector_types',
    'discord_bot_token',
    'ad_fuel_cutoff_date',
    'crm_name',
    'stripe_api_key', 'stripe_webhook_secret',
    'ads_sync_frequency', 'ads_sync_hour_utc',
    'master_writing_prompt',
    'metric_alert_window_days',
    'serp_api_key', 'serp_api_provider',
    'service_area_master_prompt',
    'service_page_master_prompt',
    'regular_page_master_prompt',
    'payment_sound_url',
    'discord_ops_channel_id',
    'consolidated_email_notifications',
    'monthly_review_schedule',
  ]
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (body[key] !== undefined) patch[key] = body[key]
  }

  const db = createAdminClient()
  const { data: existing } = await db.from('agency_settings').select('id').single()
  if (!existing?.id) {
    return NextResponse.json({ error: 'Settings row not found — run migrations' }, { status: 500 })
  }

  const { data, error } = await db
    .from('agency_settings')
    .update(patch)
    .eq('id', existing.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  revalidatePath('/admin/settings')
  revalidatePath('/admin')
  revalidateTag('agency-settings')  // bust the cached getAgencySettings() on client dashboards

  const adminSession = await getAdminSession()
  logActivity(adminSession, 'updated', 'agency_settings', { meta: { fields: Object.keys(patch) } })
  return NextResponse.json(data)
}
