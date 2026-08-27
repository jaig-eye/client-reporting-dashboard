// POST /api/admin/settings/test-email
//
// Sends a real email and reports what actually happened.
//
// Every other send in this codebase is deliberately silent: forgot-password
// swallows failures so the response cannot reveal which addresses exist, and the
// cron digests are fire-and-forget. That is correct for each of them, but it
// leaves no way to answer "is email working right now?" short of triggering a
// password reset and hoping. Hence one endpoint whose entire job is to fail
// loudly and say why.
//
// Body: { to?: string }  — defaults to agency_settings.notification_email

import { NextRequest, NextResponse } from 'next/server'
import { cookies }                   from 'next/headers'
import { createAdminClient }         from '@/lib/supabase/server'
import { isAdminAuthed }             from '@/lib/auth'
import { sendEmail, isEmailConfigured } from '@/lib/email'

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // The From address comes from MAILGUN_FROM, NOT from agency settings — a
  // common source of confusion, so it is echoed back explicitly.
  const from = process.env.MAILGUN_FROM
    ?? process.env.MAILGUN_SMTP_USER
    ?? '(not set — falling back to noreply@example.com)'
  const host = process.env.MAILGUN_SMTP_HOST ?? 'smtp.mailgun.org (default)'

  if (!isEmailConfigured()) {
    return NextResponse.json({
      ok: false,
      configured: false,
      from,
      host,
      error: 'MAILGUN_SMTP_USER / MAILGUN_SMTP_PASS are not set on this deployment, so nothing can be sent. Super-admin login is also blocked while this is true, because the OTP cannot be delivered.',
    }, { status: 400 })
  }

  const db = createAdminClient()
  const { data: settings } = await db
    .from('agency_settings')
    .select('notification_email, agency_name')
    .maybeSingle()

  const body = await request.json().catch(() => ({})) as { to?: unknown }
  const to = typeof body.to === 'string' && body.to.trim()
    ? body.to.trim()
    : (settings as { notification_email?: string } | null)?.notification_email

  if (!to) {
    return NextResponse.json({
      ok: false,
      configured: true,
      from,
      host,
      error: 'No recipient. Set a notification email in agency settings, or pass one explicitly.',
    }, { status: 400 })
  }

  const agencyName = (settings as { agency_name?: string } | null)?.agency_name ?? 'Agency Dashboard'
  const stamp = new Date().toISOString()

  try {
    await sendEmail({
      to,
      subject: `${agencyName} — Test email`,
      text: `Email delivery is working.\n\nSent ${stamp}\nFrom ${from}\nvia ${host}`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:420px;margin:0 auto;padding:32px 24px;">
          <h2 style="font-size:18px;font-weight:700;color:#111827;margin:0 0 8px;">Email delivery is working</h2>
          <p style="font-size:14px;color:#6b7280;margin:0 0 20px;">
            If you are reading this, password reset codes and super-admin login codes will reach you.
          </p>
          <table style="font-size:12px;color:#6b7280;line-height:1.8;">
            <tr><td style="padding-right:12px;color:#9ca3af;">Sent</td><td>${stamp}</td></tr>
            <tr><td style="padding-right:12px;color:#9ca3af;">From</td><td>${from}</td></tr>
            <tr><td style="padding-right:12px;color:#9ca3af;">Via</td><td>${host}</td></tr>
          </table>
        </div>`,
    })
    return NextResponse.json({ ok: true, configured: true, to, from, host, sentAt: stamp })
  } catch (e) {
    // The real SMTP error, verbatim. This is the whole point of the endpoint:
    // "authentication failed", "domain not verified" and "connection timeout"
    // have completely different fixes, and every other call site hides them.
    const detail = e instanceof Error ? e.message : String(e)
    console.error('[test-email] send failed:', detail)
    return NextResponse.json({
      ok: false, configured: true, to, from, host, error: detail,
    }, { status: 502 })
  }
}
