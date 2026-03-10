// Admin login — supports two modes:
//   1. Super admin: email blank, password = ADMIN_PASSWORD env var
//   2. Regular admin: email + password verified against users table

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { hashPassword } from '@/lib/auth'

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 60 * 60 * 24 * 30,
  path: '/',
}

export async function POST(request: NextRequest) {
  const { email, password } = await request.json()

  if (!password) {
    return NextResponse.json({ error: 'Password required' }, { status: 400 })
  }

  // ── Super admin path: no email, just the env var password ──────────────────
  if (!email || email.trim() === '') {
    if (password !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
    }
    const res = NextResponse.json({ ok: true, role: 'super_admin' })
    res.cookies.set('admin_session', process.env.ADMIN_PASSWORD!, COOKIE_OPTS)
    res.cookies.delete('admin_user_id')
    return res
  }

  // ── Regular user path: email + password ────────────────────────────────────
  const db = createAdminClient()
  const { data: user } = await db
    .from('users')
    .select('id, role, password_hash, is_active')
    .eq('email', email.toLowerCase().trim())
    .eq('is_active', true)
    .single()

  if (!user || user.password_hash !== hashPassword(password)) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  // Record login time (fire-and-forget)
  db.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id)

  const res = NextResponse.json({ ok: true, role: user.role })
  res.cookies.set('admin_session', process.env.ADMIN_PASSWORD!, COOKIE_OPTS)
  res.cookies.set('admin_user_id', user.id, COOKIE_OPTS)
  return res
}
