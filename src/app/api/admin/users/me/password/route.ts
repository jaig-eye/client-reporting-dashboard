// POST /api/admin/users/me/password — change the current user's password.
// Requires current_password for verification. Super admin cannot use this.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getVerifiedUserId, verifyPassword, hashPasswordSecure, passwordTooLong, MAX_PASSWORD_BYTES, getAdminSession } from '@/lib/auth'
import { logActivity } from '@/lib/activity'

export async function POST(req: NextRequest) {
  const session = req.cookies.get('admin_session')?.value

  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = getVerifiedUserId(session)
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
  const { data: user } = await db
    .from('users')
    .select('id, password_hash')
    .eq('id', userId)
    .single()

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const { ok: hashMatch } = verifyPassword(current_password, user.password_hash)
  if (!hashMatch) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 })
  }

  const { error } = await db
    .from('users')
    .update({ password_hash: hashPasswordSecure(new_password) })
    .eq('id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const adminSession = await getAdminSession()
  logActivity(adminSession, 'updated', 'user', { resourceId: userId, meta: { field: 'password' } })
  return NextResponse.json({ success: true })
}
