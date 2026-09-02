// POST /api/admin/users/me/password — change the current user's password.
// Requires current_password for verification. Super admin cannot use this.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyPassword, hashPasswordSecure, passwordTooLong, MAX_PASSWORD_BYTES, getAdminSession } from '@/lib/auth'
import { signAdminSession, SESSION_TTL_SECONDS } from '@/lib/session'
import { logActivity } from '@/lib/activity'

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  maxAge: SESSION_TTL_SECONDS,
  path: '/',
}

export async function POST(req: NextRequest) {
  // getAdminSession, NOT isAdminAuthed. This route clears must_reset_password and
  // re-issues the cookie, so gating it on the revocation-blind HMAC check let a
  // session UN-REVOKE ITSELF: after a force-reset (password_changed_at stamped,
  // every issued cookie rejected by getAdminSession, the account refused at login),
  // whoever held the stolen cookie plus the current password could POST here,
  // pass the pure-crypto check, clear the forced-rotation flag, and walk away with
  // a freshly signed 14-day session — defeating the exact eviction the flag exists
  // to perform, and locking the real owner out behind the attacker's new password.
  //
  // getAdminSession re-reads the row, so it enforces is_active AND the
  // password_changed_at cutoff. It is deliberately not requireVerifiedAdmin: every
  // role, viewers included, must be able to change their OWN password.
  const adminSession = await getAdminSession()
  if (!adminSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = adminSession.userId
  if (!userId) {
    return NextResponse.json({ error: 'Super admin password is set via environment variable' }, { status: 403 })
  }

  const { current_password, new_password } = await req.json()
  if (!current_password || !new_password) {
    return NextResponse.json({ error: 'current_password and new_password are required' }, { status: 400 })
  }
  // typeof, not just length: a JSON number passes `undefined < 10` and then throws
  // inside Buffer.byteLength.
  if (typeof new_password !== 'string') {
    return NextResponse.json({ error: 'new_password must be text' }, { status: 400 })
  }
  if (passwordTooLong(new_password)) {
    return NextResponse.json({ error: `Password is too long — it must be ${MAX_PASSWORD_BYTES} bytes or fewer (roughly ${MAX_PASSWORD_BYTES} characters, fewer if you use emoji or accents).` }, { status: 400 })
  }
  if (new_password.length < 10) {
    return NextResponse.json({ error: 'Password must be at least 10 characters' }, { status: 400 })
  }

  const db = createAdminClient()
  // is_active filter: without it a DEACTIVATED admin could still rotate their own
  // password here and be handed a freshly signed session, re-authenticating an
  // account that was switched off. maybeSingle per CLAUDE.md — .single() 406s
  // rather than returning null when the row is filtered out.
  const { data: user } = await db
    .from('users')
    .select('id, role, password_hash')
    .eq('id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const { ok: hashMatch } = await verifyPassword(current_password, user.password_hash)
  if (!hashMatch) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 })
  }

  // Identity for the audit row was captured by the gate at the top of this handler,
  // which is also BEFORE password_changed_at is stamped — re-reading it here would
  // return null, because the stamp revokes every session minted before it including
  // this request's own cookie.

  // Stamp password_changed_at so a self-service change also satisfies forced
  // rotation and invalidates OTHER sessions; must_reset_password:false clears any
  // pending flag now that the user has rotated.
  const now = new Date().toISOString()
  let { error } = await db
    .from('users')
    .update({ password_hash: await hashPasswordSecure(new_password), must_reset_password: false, password_changed_at: now })
    .eq('id', user.id)

  if (error && /must_reset_password|password_changed_at/i.test(error.message)) {
    ;({ error } = await db
      .from('users')
      .update({ password_hash: await hashPasswordSecure(new_password) })
      .eq('id', user.id))
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  logActivity(adminSession, 'updated', 'user', { resourceId: userId, meta: { field: 'password' } })

  // Re-issue THIS session with a fresh iat so stamping password_changed_at does
  // not log the user out of the very request that changed their password. Older
  // sessions on other devices are correctly revoked by the new cutoff.
  const res = NextResponse.json({ success: true })
  res.cookies.set(
    'admin_session',
    signAdminSession({ isSuperAdmin: false, userId, role: user.role ?? undefined }),
    COOKIE_OPTS,
  )
  return res
}
