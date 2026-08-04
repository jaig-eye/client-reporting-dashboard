// GET /api/cron/email-reminders
// Weekly cron (Monday 9am): for each active email schedule, if no email has been
// submitted in the past 7 days, send a Discord reminder to the ops channel.

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeCompare }         from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase/server'
import { sendDiscordMessage }        from '@/lib/discord'
import { getNotif, type NotifConfig } from '@/lib/notificationConfig'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!timingSafeCompare(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  // Load Discord config + active schedules in parallel
  const [settingsRes, schedulesRes] = await Promise.all([
    db.from('agency_settings')
      .select('discord_bot_token, discord_ops_channel_id, notification_config')
      .maybeSingle(),
    db.from('email_schedules')
      .select('client_id, emails_per_week, assigned_user_id, clients(name, discord_channel_id), users(name)')
      .eq('is_active', true),
  ])

  const botToken    = (settingsRes.data?.discord_bot_token as string | null) ?? null
  const opsChannel  = ((settingsRes.data?.discord_ops_channel_id as string | null) ?? process.env.DISCORD_OPS_CHANNEL_ID) ?? null
  const notifConfig = ((settingsRes.data?.notification_config as NotifConfig | null)) ?? {}

  if (!botToken || !opsChannel) {
    return NextResponse.json({ ok: true, skipped: 'Discord not configured' })
  }

  const schedules = schedulesRes.data ?? []
  if (schedules.length === 0) {
    return NextResponse.json({ ok: true, checked: 0 })
  }

  // Check each client: did they submit at least (emails_per_week) emails in the past 7 days?
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()

  const results = await Promise.allSettled(
    schedules.map(async (sched) => {
      const { count } = await db
        .from('email_campaigns')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', sched.client_id)
        .in('status', ['pending_review', 'approved'])
        .gte('created_at', sevenDaysAgo)

      const submitted = count ?? 0
      if (submitted >= sched.emails_per_week) return { clientId: sched.client_id, reminded: false }

      type ClientJoin = { name: string; discord_channel_id: string | null }
      const clientRow    = sched.clients as unknown as ClientJoin | null
      const clientName   = clientRow?.name ?? 'Unknown client'
      const assignedName = (sched.users as unknown as { name: string } | null)?.name

      const msg =
        `⏰ **Email reminder:** _${clientName}_ needs **${sched.emails_per_week} email${sched.emails_per_week > 1 ? 's' : ''}** this week.\n` +
        `📊 Submitted so far: ${submitted}/${sched.emails_per_week}\n` +
        (assignedName ? `👤 Assigned: ${assignedName}\n` : '') +
        `→ Upload at /admin/emails`

      const notif = getNotif(notifConfig, 'email_reminder')
      if (notif.email) await sendDiscordMessage(botToken, opsChannel, msg)

      // Also ping the client's own Discord channel if configured
      if (clientRow?.discord_channel_id && notif.client) {
        await sendDiscordMessage(botToken, clientRow.discord_channel_id, msg)
      }

      return { clientId: sched.client_id, reminded: true }
    })
  )

  const reminded = results.filter(r => r.status === 'fulfilled' && (r.value as { reminded: boolean }).reminded).length

  return NextResponse.json({ ok: true, checked: schedules.length, reminded })
}
