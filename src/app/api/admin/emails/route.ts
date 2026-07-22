import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed }             from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase/server'
import { sendDiscordMessage }        from '@/lib/discord'

export async function GET(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('client_id')
  const status   = searchParams.get('status')

  const db = createAdminClient()
  let query = db
    .from('email_campaigns')
    .select(`
      id, client_id, title, subject_line, goal,
      preview_image_url, preview_url, html_content,
      sent_at, utm_campaign,
      open_rate, click_rate, conversions, revenue,
      status, reviewer_notes, reviewed_at,
      submitted_by, reviewed_by, created_at, updated_at,
      clients(name),
      submitter:users!submitted_by(name, avatar_url),
      reviewer:users!reviewed_by(name)
    `)
    .order('created_at', { ascending: false })
    .limit(100)

  if (clientId) query = query.eq('client_id', clientId)
  if (status && status !== 'all') query = query.eq('status', status)

  const { data, error } = await query
  if (error) {
    console.error('[emails GET]', error)
    return NextResponse.json({ error: 'Failed to load emails' }, { status: 500 })
  }

  return NextResponse.json({ emails: data ?? [] })
}

export async function POST(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = request.cookies.get('admin_user_id')?.value ?? null

  let body: {
    client_id:         string
    title:             string
    subject_line?:     string
    goal?:             string
    preview_image_url?: string
    html_content?:     string
    preview_url?:      string
    sent_at?:          string
    utm_campaign?:     string
    status?:           'draft' | 'pending_review'
  }
  try {
    body = await request.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.client_id || !body.title?.trim()) {
    return NextResponse.json({ error: 'client_id and title are required' }, { status: 400 })
  }

  const db = createAdminClient()

  const { data: campaign, error } = await db
    .from('email_campaigns')
    .insert({
      client_id:         body.client_id,
      title:             body.title.trim(),
      subject_line:      body.subject_line?.trim() || null,
      goal:              body.goal?.trim() || null,
      preview_image_url: body.preview_image_url || null,
      html_content:      body.html_content || null,
      preview_url:       body.preview_url || null,
      sent_at:           body.sent_at || null,
      utm_campaign:      body.utm_campaign?.trim() || null,
      status:            body.status === 'draft' ? 'draft' : 'pending_review',
      submitted_by:      userId,
    })
    .select('id, title, client_id, status, submitted_by, clients(name)')
    .single()

  if (error || !campaign) {
    console.error('[emails POST]', error)
    return NextResponse.json({ error: 'Failed to create email' }, { status: 500 })
  }

  // Discord notification — non-blocking
  void (async () => {
    try {
      const { data: settings } = await db
        .from('agency_settings')
        .select('discord_bot_token, discord_ops_channel_id')
        .maybeSingle()

      const { data: submitter } = userId
        ? await db.from('users').select('name').eq('id', userId).maybeSingle()
        : { data: null }

      const clientName = (campaign.clients as unknown as { name: string } | null)?.name ?? 'Unknown client'
      const submitterName = submitter?.name ?? 'Admin'
      const botToken  = settings?.discord_bot_token as string | null
      const opsChannel = ((settings?.discord_ops_channel_id as string | null) ?? process.env.DISCORD_OPS_CHANNEL_ID) ?? null

      const msg =
        `📧 **New email submitted** for **${clientName}**\n` +
        `📌 _${campaign.title}_${body.goal ? ` — Goal: ${body.goal}` : ''}\n` +
        `👤 Submitted by ${submitterName} · Review at /admin/emails`

      await sendDiscordMessage(botToken, opsChannel, msg)

      // Also ping per-client Discord channel
      const { data: client } = await db
        .from('clients')
        .select('discord_channel_id')
        .eq('id', body.client_id)
        .maybeSingle()
      if (client?.discord_channel_id) {
        await sendDiscordMessage(botToken, client.discord_channel_id as string, msg)
      }
    } catch (e) {
      console.error('[emails POST discord]', e)
    }
  })()

  return NextResponse.json({ email: campaign }, { status: 201 })
}
