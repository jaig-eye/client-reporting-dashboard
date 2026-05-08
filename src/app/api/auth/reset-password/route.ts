// POST /api/auth/reset-password
// Body: { token: string; password: string }

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { hashPassword } from '@/lib/auth'
import { createHash } from 'crypto'

export async function POST(request: NextRequest) {
  const { token, password } = await request.json() as { token?: string; password?: string }

  if (!token || !password) {
    return NextResponse.json({ error: 'Token and password are required' }, { status: 400 })
  }

  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  const tokenHash = createHash('sha256').update(token).digest('hex')
  const db        = createAdminClient()
  const now       = new Date().toISOString()

  const { data: record } = await db
    .from('password_reset_tokens')
    .select('id, user_id')
    .eq('token_hash', tokenHash)
    .is('used_at', null)
    .gt('expires_at', now)
    .maybeSingle()

  if (!record) {
    return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 })
  }

  await db
    .from('users')
    .update({ password_hash: hashPassword(password) })
    .eq('id', record.user_id)

  await db
    .from('password_reset_tokens')
    .update({ used_at: now })
    .eq('id', record.id)

  return NextResponse.json({ ok: true })
}
