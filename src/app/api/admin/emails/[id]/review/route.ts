import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed }             from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase/server'
import { sendDiscordMessage }        from '@/lib/discord'
import { getNotif, type NotifConfig } from '@/lib/notificationConfig'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const userId = request.cookies.get('admin_user_id')?.value ?? null

  let body: { action: 'approve' | 'reject'; notes?: string }
  try {
    body = await request.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!['approve', 'reject'].includes(body.action)) {
    return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
  }
  if (body.action === 'reject' && !body.notes?.trim()) {
    return NextResponse.json({ error: 'notes are required when rejecting' }, { status: 400 })
  }

  const db = createAdminClient()

  const { data: existing } = await db
    .from('email_campaigns')
    .select('status')
    .eq('id', id)
    .maybeSingle()

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status !== 'pending_review') {
    return NextResponse.json({ error: 'Email has already been reviewed' }, { status: 409 })
  }

  const { data, error } = await db
    .from('email_campaigns')
    .update({
      status:         body.action === 'approve' ? 'approved' : 'rejected',
      reviewer_notes: body.notes?.trim() || null,
      reviewed_by:    userId,
      reviewed_at:    new Date().toISOString(),
      updated_at:     new Date().toISOString(),
    })
    .eq('id', id)
    .select('id, status, reviewer_notes, reviewed_at')
    .maybeSingle()

  if (error) {
    console.error('[email review POST]', error)
    return NextResponse.json({ error: 'Failed to update review' }, { status: 500 })
  }

  // Fire approval notification non-blocking
  if (body.action === 'approve') {
    void (async () => {
      try {
        const { data: settings } = await db
          .from('agency_settings')
          .select('discord_bot_token, discord_ops_channel_id, notification_config')
          .maybeSingle()

        const { data: reviewer } = userId
          ? await db.from('users').select('name').eq('id', userId).maybeSingle()
          : { data: null }

        const { data: campaign } = await db
          .from('email_campaigns')
          .select('title, client_id, clients(name)')
          .eq('id', id)
          .maybeSingle()

        const reviewerName  = reviewer?.name ?? 'Admin'
        const clientName    = (campaign?.clients as unknown as { name: string } | null)?.name ?? 'Unknown client'
        const botToken      = settings?.discord_bot_token as string | null
        const opsChannel    = ((settings?.discord_ops_channel_id as string | null) ?? process.env.DISCORD_OPS_CHANNEL_ID) ?? null
        const notifConfig   = (settings?.notification_config as NotifConfig | null) ?? {}
        const notif         = getNotif(notifConfig, 'email_approved')
        const baseUrl       = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
        const emailUrl      = `${baseUrl}/admin/emails?open=${id}`

        const msg =
          `✅ **Email approved** for **${clientName}**\n` +
          `📌 _${campaign?.title ?? 'Untitled'}_\n` +
          `👤 Approved by ${reviewerName}\n` +
          `🔗 [View email](${emailUrl})`

        if (botToken && opsChannel && notif.agency) await sendDiscordMessage(botToken, opsChannel, msg)

        if (notif.client && campaign?.client_id) {
          const { data: client } = await db
            .from('clients')
            .select('discord_channel_id')
            .eq('id', campaign.client_id)
            .maybeSingle()
          if (botToken && client?.discord_channel_id) {
            await sendDiscordMessage(botToken, client.discord_channel_id as string, msg)
          }
        }
      } catch (e) {
        console.error('[email review approve discord]', e)
      }
    })()
  }

  return NextResponse.json({ email: data })
}
