// PATCH /api/admin/users/[id] — update user (super admin only)
// DELETE /api/admin/users/[id] — delete user (super admin only)

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isSuperAdminAuthed, hashPasswordSecure, passwordTooLong, MAX_PASSWORD_BYTES, getAdminSession } from '@/lib/auth'
import { logActivity } from '@/lib/activity'

function isSuperAdmin(req: NextRequest): boolean {
  // Signed super-admin claim, not the absence of a client-editable cookie.
  return isSuperAdminAuthed(req.cookies.get('admin_session')?.value)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()

  const allowed = ['name', 'email', 'role', 'is_active']
  const update: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) update[key] = body[key]
  }
  if (body.email)    update.email    = (body.email as string).toLowerCase().trim()
  if ('username' in body) update.username = body.username ? (body.username as string).toLowerCase().trim() : null
  if (body.password) {
    // typeof, not just truthiness: a JSON number is truthy and would throw inside
    // Buffer.byteLength (in passwordTooLong), surfacing as an unhandled 500 instead
    // of a clean 400.
    if (typeof body.password !== 'string') {
      return NextResponse.json({ error: 'Password must be text' }, { status: 400 })
    }
    if (passwordTooLong(body.password)) {
      return NextResponse.json({ error: `Password is too long — it must be ${MAX_PASSWORD_BYTES} bytes or fewer (roughly ${MAX_PASSWORD_BYTES} characters, fewer if you use emoji or accents).` }, { status: 400 })
    }
    if (body.password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }
    update.password_hash = await hashPasswordSecure(body.password)
    // An admin-set password must RESTORE login. Clearing must_reset_password (and
    // stamping password_changed_at) is what makes that true: otherwise a flagged
    // account — migration 195 backfill, or a prior force-reset — stays blocked even
    // after the admin hands them a fresh password, because admin-login's mustReset
    // branch keeps refusing a session and mailing a code. reset-password is
    // otherwise the ONLY path that clears the flag.
    update.must_reset_password = false
    update.password_changed_at = new Date().toISOString()
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const db = createAdminClient()
  let { data, error } = await db
    .from('users')
    .update(update)
    .eq('id', id)
    .select('id, name, email, role, is_active')
    .single()

  // Deploy-ordering fallback: the rotation columns only exist from migration 195.
  // If the code shipped ahead of it, retry without them so a password can still be
  // set (the flag simply does not exist yet).
  if (error && /must_reset_password|password_changed_at/i.test(error.message)) {
    const rest = { ...update }
    delete rest.must_reset_password
    delete rest.password_changed_at
    ;({ data, error } = await db
      .from('users')
      .update(rest)
      .eq('id', id)
      .select('id, name, email, role, is_active')
      .single())
  }

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Email already in use' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const adminSession = await getAdminSession()
  logActivity(adminSession, 'updated', 'user', {
    resourceId: id,
    meta: { name: (data as { name?: string } | null)?.name ?? '', email: (data as { email?: string } | null)?.email ?? '' },
  })
  return NextResponse.json(data)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 })
  }

  const { id } = await params
  const db = createAdminClient()
  const { data: userRow } = await db.from('users').select('name').eq('id', id).single()
  const { error } = await db.from('users').delete().eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const adminSession = await getAdminSession()
  logActivity(adminSession, 'deleted', 'user', {
    resourceId: id,
    meta: { name: (userRow as { name?: string } | null)?.name ?? '' },
  })
  return NextResponse.json({ success: true })
}
