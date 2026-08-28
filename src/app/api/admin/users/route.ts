// GET  /api/admin/users — list active users (any admin)
// POST /api/admin/users — create a new admin user (super admin only)

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, isSuperAdminAuthed, hashPasswordSecure, passwordTooLong, MAX_PASSWORD_BYTES, getAdminSession } from '@/lib/auth'
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

function isSuperAdmin(req: NextRequest): boolean {
  // Super admin is a SIGNED claim in the session token — not the absence of a
  // client-editable cookie (which previously allowed trivial escalation).
  return isSuperAdminAuthed(req.cookies.get('admin_session')?.value)
}

export async function POST(req: NextRequest) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 })
  }

  const body = await parseBody<{ name?: string; email?: string; password?: string; role?: string; username?: string }>(req)
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  const { name, email, password, role, username } = body

  if (!name || !email || !password) {
    return NextResponse.json({ error: 'name, email, and password are required' }, { status: 400 })
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
  if (!['admin', 'viewer'].includes(role ?? 'admin')) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('users')
    .insert({
      name,
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

  const adminSession = await getAdminSession()
  logActivity(adminSession, 'created', 'user', {
    resourceId: data.id,
    meta: { name: data.name, email: data.email, role: data.role },
  })
  return NextResponse.json(data, { status: 201 })
}
