import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { getAdminSession, isAdminAuthed } from '@/lib/auth'
import { logActivity }     from '@/lib/activity'
import { parseBody }       from '@/lib/apiError'

// This file used to define its OWN isAdminAuthed that shadowed the imported one
// and compared the cookie to the raw ADMIN_PASSWORD. Because the shadow
// typechecks, the sweep that converted every other route to signed sessions
// silently skipped it — leaving a check that (a) can never pass for a real
// signed session, and (b) accepts the old ADMIN_PASSWORD value, which
// `select('*')` below turns into a disclosure of super_admin_otp_hash. That hash
// is an unsalted SHA-256 of a six-digit OTP, i.e. brute-forceable offline in
// under a second, so the backdoor completed super-admin 2FA without the email.

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const { data, error } = await db.from('agency_settings').select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // The live super-admin OTP never leaves the server. It is an unsalted SHA-256
  // of a six-digit code, so anyone who reads the hash can recover the code
  // offline in well under a second and complete super-admin 2FA without ever
  // receiving the email. No UI reads these two columns; `select('*')` was simply
  // sweeping them up.
  const { super_admin_otp_hash, super_admin_otp_expires_at, ...safe } =
    data as Record<string, unknown>
  void super_admin_otp_hash; void super_admin_otp_expires_at

  return NextResponse.json(safe)
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
    'show_blog_posts',
    'discord_bot_token',
    'ad_fuel_cutoff_date',
    'crm_name',
    'stripe_api_key', 'stripe_webhook_secret',
    'ads_sync_frequency', 'ads_sync_hour_utc',
    'master_writing_prompt',
    'metric_alert_window_days',
    'contact_stale_days',
    'quality_gate_blocks_autopush',
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

  // contact_stale_days drives a cron that emails, Discords and alerts on every
  // client it considers overdue, so a bad value is loud and self-sustaining.
  // Zero is the realistic way to get one: clearing the number input sends '',
  // and Number('') is 0, which then makes EVERY client stale on every run while
  // also defeating the once-per-streak dedup (its re-arm window is `now - 0`).
  // `min`/`max` on the input are browser hints only, and migration 198 put the
  // 1..365 CHECK on clients.contact_stale_days but not on the agency default —
  // so this is the only place it can be enforced.
  if (patch.contact_stale_days !== undefined) {
    const n = Math.trunc(Number(patch.contact_stale_days))
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      return NextResponse.json(
        { error: 'Contact window must be a whole number of days between 1 and 365.' },
        { status: 400 },
      )
    }
    patch.contact_stale_days = n
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

  // Strip the super-admin OTP columns from the response exactly as GET does. The
  // bare .select() returns the full row, so while a super-admin login is mid-flight
  // this PUT would hand any authenticated admin the live OTP hash — an unsalted
  // SHA-256 of a six-digit code, recoverable offline in under a second — letting
  // them complete super-admin 2FA without the email.
  const { super_admin_otp_hash, super_admin_otp_expires_at, ...safe } =
    data as Record<string, unknown>
  void super_admin_otp_hash; void super_admin_otp_expires_at
  return NextResponse.json(safe)
}
