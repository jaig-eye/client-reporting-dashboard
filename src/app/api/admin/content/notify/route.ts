// POST /api/admin/content/notify
// Sends an email notification. Used by the agency settings "Send Test" button
// and internally by the topics/generation workflow.
//
// Body: { type?: 'test' | 'topics_created' | 'post_generated' | 'approval_needed', subject?, html?, to? }
// Reads notification_email from agency_settings when `to` is not provided.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email'
import { isSuperAdminAuthed } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')?.value
  // Super admin only. This endpoint sends email to an arbitrary `to` with an
  // arbitrary subject/html — an open relay if any authenticated admin can reach it.
  // The settings "Send Test" button now uses /api/admin/settings/test-email (which
  // pins non-super-admins to the configured address); this route has no other UI
  // caller, and internal callers authenticate with the super-admin internal cookie,
  // so restricting it to super admin closes the relay without breaking them.
  if (!isSuperAdminAuthed(session)) {
    return NextResponse.json({ error: 'Only the super admin can send mail through this endpoint.' }, { status: 403 })
  }

  const body = await request.json() as {
    type?: string
    subject?: string
    html?: string
    text?: string
    to?: string
    clientId?: string
    // Context fields for built-in notification types
    clientName?: string
    topicCount?: number
    postTitle?: string
    publishDate?: string
  }

  const db = createAdminClient()
  const { data: settings } = await db
    .from('agency_settings')
    .select('notification_email, agency_name')
    .single()

  const to = body.to ?? settings?.notification_email ?? ''
  if (!to) {
    return NextResponse.json({ error: 'No notification email configured — add one in Agency Settings → Notifications' }, { status: 400 })
  }

  const agencyName = (settings?.agency_name as string | null) ?? 'Agency Dashboard'
  const appUrl     = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  const clientLink = body.clientId
    ? `${appUrl}/admin/clients/${body.clientId}?tab=content&subtab=schedule`
    : `${appUrl}/admin/content`

  // Build subject + html for well-known notification types
  let subject = body.subject ?? 'Notification'
  let html    = body.html    ?? ''

  if (body.type === 'test') {
    subject = `[${agencyName}] Test Notification`
    html    = `<p>This is a test notification from <strong>${agencyName}</strong>. Your email notifications are working correctly.</p>`
  } else if (body.type === 'topics_created') {
    const client = body.clientName ?? 'a client'
    const count  = body.topicCount ?? 0
    subject = `[${agencyName}] Topics ready for review — ${client}`
    html    = `<p><strong>${count} new topic idea${count !== 1 ? 's' : ''}</strong> have been generated for <strong>${client}</strong> and are waiting for your review.</p>
               <p><a href="${clientLink}">Review &amp; Approve Topics →</a></p>`
  } else if (body.type === 'post_generated') {
    const title = body.postTitle ?? 'a post'
    const date  = body.publishDate ? ` — publishes ${body.publishDate}` : ''
    subject = `[${agencyName}] Post ready for review: ${title}`
    html    = `<p>A new post has been generated and is ready for review: <strong>${title}</strong>${date}.</p>
               <p><a href="${clientLink}">Review Post →</a></p>`
  } else if (body.type === 'approval_needed') {
    const title = body.postTitle ?? 'a post'
    const date  = body.publishDate ?? 'soon'
    subject = `[${agencyName}] Action needed — approve before ${date}: ${title}`
    html    = `<p>A post is scheduled to publish on <strong>${date}</strong> but has not yet been approved: <strong>${title}</strong>.</p>
               <p>Please review and approve it before the publish date.</p>
               <p><a href="${clientLink}">Review Post →</a></p>`
  }

  // If caller passed custom html directly, use that
  if (!body.type && body.html) {
    html = body.html
  }

  try {
    await sendEmail({ to, subject, html, text: body.text })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[notify] email send error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
