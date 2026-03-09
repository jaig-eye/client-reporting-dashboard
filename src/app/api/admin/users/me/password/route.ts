// /api/admin/users/me/password
// Change the current admin user's password.
// Requires current_password for verification before updating.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createHash } from 'crypto'

function requireAdmin(req: NextRequest): boolean {
  const session = req.cookies.get('admin_session')?.value
  return !!session && session === process.env.ADMIN_PASSWORD
}

function hashPassword(password: string): string {
  // SHA-256 hash — in production consider bcrypt, but this matches the existing auth pattern
  return createHash('sha256').update(password).digest('hex')
}

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { current_password, new_password } = body

  if (!current_password || !new_password) {
    return NextResponse.json({ error: 'current_password and new_password are required' }, { status: 400 })
  }
  if (new_password.length < 10) {
    return NextResponse.json({ error: 'Password must be at least 10 characters' }, { status: 400 })
  }

  const db = createAdminClient()

  // Get current user
  const { data: user } = await db
    .from('users')
    .select('id, password_hash')
    .eq('role', 'admin')
    .eq('is_active', true)
    .single()

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // Verify current password
  if (user.password_hash && user.password_hash !== hashPassword(current_password)) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
  }

  const { error } = await db
    .from('users')
    .update({ password_hash: hashPassword(new_password) })
    .eq('id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
