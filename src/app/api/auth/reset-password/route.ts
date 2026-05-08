// POST /api/auth/reset-password
// Step 2 of code-based password reset.
// Body: { email: string; code: string; password: string }

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { hashPassword } from '@/lib/auth'
import { createHash } from 'crypto'

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

export async function POST(request: NextRequest) {
  const { email, code, password } = await request.json() as {
    email?: string; code?: string; password?: string
  }

  if (!email || !code || !password) {
    return NextResponse.json({ error: 'Email, code, and password are required' }, { status: 400 })
  }

  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  const db  = createAdminClient()
  const now = new Date().toISOString()

  const { data: user } = await db
    .from('users')
    .select('id')
    .eq('email', email.toLowerCase().trim())
    .eq('is_active', true)
    .maybeSingle()

  if (!user) {
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })
  }

  const { data: record } = await db
    .from('password_reset_tokens')
    .select('id')
    .eq('user_id', user.id)
    .eq('token_hash', hashCode(code))
    .is('used_at', null)
    .gt('expires_at', now)
    .maybeSingle()

  if (!record) {
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })
  }

  await db
    .from('users')
    .update({ password_hash: hashPassword(password) })
    .eq('id', user.id)

  await db
    .from('password_reset_tokens')
    .update({ used_at: now })
    .eq('id', record.id)

  return NextResponse.json({ ok: true })
}
