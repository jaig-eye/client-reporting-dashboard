// POST /api/admin/users — create a new admin user (super admin only)

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, hashPassword } from '@/lib/auth'

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

  const { name, email, password, role } = await req.json()

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
      email: email.toLowerCase().trim(),
      password_hash: hashPassword(password),
      role: role ?? 'admin',
      is_active: true,
    })
    .select('id, name, email, role, is_active, created_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
