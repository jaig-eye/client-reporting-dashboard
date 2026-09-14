// GET  /api/admin/users — list active users (any admin)
// POST /api/admin/users — create a user (admins and the super admin; viewers are refused)

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, requireVerifiedAdmin, hashPasswordSecure, passwordTooLong, MAX_PASSWORD_BYTES } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { parseBody }   from '@/lib/apiError'

export async function GET(req: NextRequest) {
  const session = req.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('users')
    .select('id, name, avatar_url')
    .eq('is_active', true)
    .order('name')

  if (error) return NextResponse.json({ error: 'Failed to load users' }, { status: 500 })
  return NextResponse.json({ users: data ?? [] })
}

export async function POST(req: NextRequest) {
  // Admins can add team members, not only the super admin.
  //
  // requireVerifiedAdmin rather than the synchronous signed-token check: it reads the user
  // row, so a deactivated admin — or one whose sessions were revoked by a password change —
  // is refused even while their cookie still verifies. Viewers are refused outright.
  //
  // Nothing here can hand out more than the caller already holds. A row's role is 'admin' or
  // 'viewer' and nothing else, and super admin is not an account at all (it is the env-var
  // login), so there is no role above 'admin' for this route to escalate into.
  const gate = await requireVerifiedAdmin()
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const body = await parseBody<{ name?: string; email?: string; password?: string; role?: string; username?: string }>(req)
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  const { name, email, password, role, username } = body

  // typeof as well as presence: a JSON number or object would throw inside .toLowerCase()
  // below and surface as a 500. More of these requests now come from outside the one
  // super-admin form, so the route checks shapes rather than trusting them.
  if (typeof name !== 'string' || typeof email !== 'string' || !name.trim() || !email.trim() || !password) {
    return NextResponse.json({ error: 'name, email, and password are required' }, { status: 400 })
  }
  if (username !== undefined && username !== null && typeof username !== 'string') {
    return NextResponse.json({ error: 'Username must be text' }, { status: 400 })
  }
  // typeof, not just truthiness: a JSON number is truthy and would throw inside
  // Buffer.byteLength (passwordTooLong) as an unhandled 500 instead of a 400.
  if (typeof password !== 'string') {
    return NextResponse.json({ error: 'Password must be text' }, { status: 400 })
  }
  // hashPasswordSecure THROWS past 72 bytes (bcrypt truncates silently, so we
  // refuse rather than accept a password whose tail is ignored). Unguarded, that
  // throw is an opaque 500 with no field-level message.
  if (passwordTooLong(password)) {
    return NextResponse.json({ error: `Password is too long — it must be ${MAX_PASSWORD_BYTES} bytes or fewer (roughly ${MAX_PASSWORD_BYTES} characters, fewer if you use emoji or accents).` }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }
  if (typeof (role ?? 'admin') !== 'string' || !['admin', 'viewer'].includes(role ?? 'admin')) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('users')
    .insert({
      name:          name.trim(),
      email:         email.toLowerCase().trim(),
      password_hash: await hashPasswordSecure(password),
      role:          role ?? 'admin',
      is_active:     true,
      ...(username ? { username: username.toLowerCase().trim() } : {}),
    })
    .select('id, name, email, role, is_active, created_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Attributed to whoever created the account — worth knowing now that it is not only the
  // super admin who can.
  logActivity(gate.admin, 'created', 'user', {
    resourceId: data.id,
    meta: { name: data.name, email: data.email, role: data.role },
  })
  return NextResponse.json(data, { status: 201 })
}
