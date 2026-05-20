// POST /api/admin/users — create a new admin user (super admin only)

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, hashPassword, getAdminSession } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { parseBody }   from '@/lib/apiError'

function isSuperAdmin(req: NextRequest): boolean {
  // Super admin = authenticated but no admin_user_id cookie
  const session = req.cookies.get('admin_session')?.value
  const userId  = req.cookies.get('admin_user_id')?.value
  return isAdminAuthed(session) && !userId
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
      password_hash: hashPassword(password),
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
