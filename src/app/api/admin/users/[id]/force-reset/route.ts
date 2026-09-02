// POST /api/admin/users/[id]/force-reset
//
// Require a user to set a new password, and email them the code now.
//
// The flag alone is enough to force the rotation — a flagged account gets no
// session on its next login, and the code is sent then. But that only fires when
// the person happens to log in, which for a rotation you actually want completed
// is not good enough: someone on holiday stays on an unsalted SHA-256 hash
// indefinitely, and nobody can see that they are pending. This endpoint pushes.
//
// Super admin only. Forcing a rotation is an account-management action — the same
// class as creating or deleting a user — and it is also mildly abusable as a
// nuisance (repeatedly locking a colleague out of their session), so it does not
// belong behind a plain "is logged in" check.
//
// Body: { sendEmail?: boolean }  — default true. Pass false to flag without
// mailing, for the case where you will hand someone the reset link in person.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient }         from '@/lib/supabase/server'
import { isAdminAuthed, isSuperAdminAuthed, getAdminSession } from '@/lib/auth'
import { issueResetCode }            from '@/lib/passwordReset'
import { logActivity }               from '@/lib/activity'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Reads the SIGNED claim, so this cannot be reached by editing a cookie.
  if (!isSuperAdminAuthed(session)) {
    return NextResponse.json(
      { error: 'Forcing a password reset requires the super admin account.' },
      { status: 403 },
    )
  }

  const { id } = await params
  const body = await request.json().catch(() => ({})) as { sendEmail?: unknown }
  const shouldSend = body.sendEmail !== false

  const db = createAdminClient()

  const { data: user, error: lookupErr } = await db
    .from('users')
    .select('id, email, name, is_active')
    .eq('id', id)
    .maybeSingle()

  if (lookupErr) {
    console.error('[force-reset] lookup failed:', lookupErr.message)
    return NextResponse.json({ error: 'Could not load that user' }, { status: 500 })
  }
  if (!user)            return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (!user.is_active)  return NextResponse.json({ error: 'That account is inactive' }, { status: 400 })
  if (!user.email)      return NextResponse.json({ error: 'That account has no email address, so a code cannot be sent.' }, { status: 400 })

  // Flag FIRST. If the email then fails, the account is still correctly blocked
  // and the person can use the normal "forgot password" form to get a code —
  // whereas mailing first and failing to flag would leave the rotation optional.
  //
  // Stamp password_changed_at too: forcing a rotation is the "this account may be
  // compromised" action, so it must EVICT the account's existing sessions now
  // (getAdminSession rejects tokens older than this stamp), not merely block the
  // next login. The column is overwritten with the real change time when the user
  // completes the reset. Using it as the session-invalidation epoch keeps the fix
  // to the one column migration 195 already added.
  const now = new Date().toISOString()
  let { error: flagErr } = await db
    .from('users')
    .update({ must_reset_password: true, password_changed_at: now })
    .eq('id', user.id)

  // Deploy-ordering fallback: password_changed_at only exists from migration 195.
  if (flagErr && /password_changed_at/i.test(flagErr.message)) {
    ;({ error: flagErr } = await db
      .from('users')
      .update({ must_reset_password: true })
      .eq('id', user.id))
  }

  if (flagErr) {
    console.error('[force-reset] flag write failed:', flagErr.message)
    return NextResponse.json({ error: `Could not flag the account: ${flagErr.message}` }, { status: 500 })
  }

  const admin = await getAdminSession()
  logActivity(admin, 'password_reset_forced', 'user', {
    resourceId: user.id,
    meta: { email: user.email, emailed: shouldSend },
  })

  if (!shouldSend) {
    return NextResponse.json({
      ok: true, flagged: true, emailed: false,
      message: `${user.name ?? user.email} must set a new password at their next sign-in. No email was sent.`,
    })
  }

  const issued = await issueResetCode(db, { id: user.id, email: user.email }, { reason: 'forced' })
  if (!issued.ok) {
    // The flag stands, so this is a partial success, not a failure — say so
    // precisely rather than implying nothing happened.
    return NextResponse.json({
      ok: false, flagged: true, emailed: false,
      error: issued.reason === 'email_not_configured'
        ? `${user.email} is now required to reset, but email is not configured on this server so no code was sent. Check MAILGUN_SMTP_* — the test-email button in Settings will show the exact error.`
        : `${user.email} is now required to reset, but the code could not be sent: ${issued.detail ?? issued.reason}`,
    }, { status: 502 })
  }

  return NextResponse.json({
    ok: true, flagged: true, emailed: true,
    message: `Reset code sent to ${user.email}. They cannot sign in until they set a new password.`,
  })
}
