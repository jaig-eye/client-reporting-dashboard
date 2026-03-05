import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { detectGoalType } from '@/lib/goal-types'
import type { GoalType } from '@/lib/types'

function isAdminAuthed(session: string | undefined) {
  return session && session === process.env.ADMIN_PASSWORD
}

/**
 * GET /api/admin/clients/[id]/campaigns
 * Returns all campaign_settings for the client, merged with any campaigns in
 * campaign_metrics that don't have a settings row yet (auto-detected goal type).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const db = createAdminClient()

  // Fetch existing campaign_settings + distinct campaigns from metrics (for discovery)
  const [settingsResult, metricsResult] = await Promise.all([
    db.from('campaign_settings').select('*').eq('client_id', id).order('campaign_name'),
    db
      .from('campaign_metrics')
      .select('campaign_id, campaign_name, platform')
      .eq('client_id', id)
      .order('campaign_name'),
  ])

  const settings = settingsResult.data ?? []

  // Build a set of campaign_ids that already have settings
  const configured = new Set(settings.map(s => `${s.platform}::${s.campaign_id}`))

  // Deduplicate metrics by (platform, campaign_id)
  const seen = new Set<string>()
  const unsettled: typeof settings = []
  for (const row of (metricsResult.data ?? [])) {
    const key = `${row.platform}::${row.campaign_id}`
    if (!configured.has(key) && !seen.has(key)) {
      seen.add(key)
      // Auto-suggest goal type from campaign name
      unsettled.push({
        id: '',
        client_id: id,
        platform: row.platform,
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        goal_type: detectGoalType(row.campaign_name),
        meta_conversion_action: null,
        conversion_label: null,
        created_at: '',
        updated_at: '',
      })
    }
  }

  return NextResponse.json({ settings, unsettled })
}

/**
 * PATCH /api/admin/clients/[id]/campaigns
 * Upserts one or more campaign_settings rows.
 * Body: Array of { platform, campaign_id, campaign_name, goal_type, meta_conversion_action?, conversion_label? }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await request.json() as {
    platform: string
    campaign_id: string
    campaign_name: string
    goal_type: GoalType
    meta_conversion_action?: string | null
    conversion_label?: string | null
  }[]

  if (!Array.isArray(body) || body.length === 0) {
    return NextResponse.json({ error: 'Body must be a non-empty array' }, { status: 400 })
  }

  const rows = body.map(b => ({
    client_id: id,
    platform: b.platform,
    campaign_id: b.campaign_id,
    campaign_name: b.campaign_name,
    goal_type: b.goal_type,
    meta_conversion_action: b.meta_conversion_action ?? null,
    conversion_label: b.conversion_label ?? null,
    updated_at: new Date().toISOString(),
  }))

  const db = createAdminClient()
  const { data, error } = await db
    .from('campaign_settings')
    .upsert(rows, { onConflict: 'client_id,platform,campaign_id' })
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  revalidatePath(`/admin/clients/${id}`)
  revalidatePath('/dashboard')

  return NextResponse.json(data)
}
