import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { logActivity }                   from '@/lib/activity'
import { parseBody }                     from '@/lib/apiError'

/**
 * GET /api/admin/content/client-settings?client_id=X
 * Returns content_settings for a specific client.
 *
 * PUT /api/admin/content/client-settings
 * Body: { client_id, ...fields }
 * Upserts content_settings for the client.
 */

export async function GET(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const clientId = request.nextUrl.searchParams.get('client_id')
  if (!clientId) return NextResponse.json({ error: 'Missing client_id' }, { status: 400 })

  const db = createAdminClient()
  const [{ data }, { data: clientRow }] = await Promise.all([
    db.from('content_settings')
      .select('business_background, services, target_audience, geographic_focus, brand_voice, sitemap_url, sitemap_urls, manual_link_urls, phone_number, post_structure, auto_generate, schedule_frequency, schedule_day_of_week, target_length, connection_id, default_author_id, default_category_ids, monthly_publish_day, weeks_ahead, cta_list, schedule_start_date, eeat_data, publish_time, wp_publish_mode, topic_guidelines, auto_approve_topics, auto_push_posts, wizard_completed, content_image_generation, content_image_prompt, generate_service_pages, generate_regular_pages, service_page_topic_guidelines, regular_page_topic_guidelines, service_page_auto_generate, regular_page_auto_generate, blog_url_prefix, bc_author, vertical, exclude_product_sitemaps')
      .eq('client_id', clientId)
      .maybeSingle(),
    db.from('clients').select('phone').eq('id', clientId).maybeSingle(),
  ])

  const result: Record<string, unknown> = { ...(data ?? {}) }
  if ((result.phone_number == null || result.phone_number === '') && clientRow?.phone) {
    result.phone_number = clientRow.phone
  }

  return NextResponse.json(result)
}

const CONTENT_FIELDS = [
  'business_background', 'services', 'target_audience', 'geographic_focus',
  'brand_voice', 'sitemap_url', 'sitemap_urls', 'manual_link_urls', 'phone_number',
  'post_structure', 'auto_generate', 'schedule_frequency',
  'schedule_day_of_week', 'target_length', 'connection_id', 'default_author_id',
  'monthly_publish_day', 'weeks_ahead', 'cta_list',
  'schedule_start_date', 'eeat_data', 'publish_time', 'wp_publish_mode',
  'topic_guidelines', 'auto_approve_topics', 'auto_push_posts', 'wizard_completed',
  'generate_service_pages', 'generate_regular_pages',
  'service_page_topic_guidelines', 'regular_page_topic_guidelines',
  'service_page_auto_generate', 'regular_page_auto_generate',
  'content_image_generation', 'content_image_prompt',
  'default_category_ids',
  'blog_url_prefix',
  'bc_author',
  'vertical',
  'exclude_product_sitemaps',
] as const

export async function PUT(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await parseBody<Record<string, unknown>>(request)
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  const { client_id } = body

  if (!client_id) return NextResponse.json({ error: 'Missing client_id' }, { status: 400 })

  // Only include fields that were explicitly sent in the request body.
  // This prevents saving Brand DNA from nulling out Schedule fields and vice versa.
  const row: Record<string, unknown> = { client_id, updated_at: new Date().toISOString() }
  for (const f of CONTENT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, f)) {
      // Array fields must remain arrays; everything else coerces null
      if (f === 'sitemap_urls' || f === 'manual_link_urls') {
        row[f] = Array.isArray(body[f]) ? body[f] : []
      } else {
        row[f] = body[f] ?? null
      }
    }
  }

  const db = createAdminClient()
  const { error } = await db
    .from('content_settings')
    .upsert(row, { onConflict: 'client_id', ignoreDuplicates: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Keep clients.phone in sync with content_settings.phone_number
  if (Object.prototype.hasOwnProperty.call(body, 'phone_number')) {
    const { error: phoneErr } = await db.from('clients')
      .update({ phone: body.phone_number ?? null })
      .eq('id', String(client_id))
    if (phoneErr) console.error('[client-settings] phone sync to clients failed:', phoneErr.message)
  }

  const adminSession = await getAdminSession()
  logActivity(adminSession, 'updated', 'content_settings', {
    clientId: String(client_id),
    meta: { fields: Object.keys(body).filter(k => k !== 'client_id') },
  })
  return NextResponse.json({ ok: true })
}
