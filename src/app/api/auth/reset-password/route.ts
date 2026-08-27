// POST /api/auth/reset-password
// Step 2 of code-based password reset.
// Body: { email: string; code: string; password: string }

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { hashPasswordSecure, passwordTooLong, MAX_PASSWORD_BYTES } from '@/lib/auth'
import { hashResetCode } from '@/lib/passwordReset'

// ── Per-IP rate limit on CODE VERIFICATION ───────────────────────────────────
//
// This endpoint had none. The code is six digits (~9x10^5) with a ten-minute
// life, `password_reset_tokens` has no attempt counter, and a hit rewrites the
// password outright — so an unmetered verifier is a straight path to account
// takeover, and it locks the real owner out on the way. forgot-password limits
// only ISSUANCE, which does nothing to slow guessing against a code already sent.
//
// In-memory, matching the login route; the same per-instance caveat applies and
// is still far better than unlimited.
const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
const attempts = new Map<string, { count: number; resetAt: number }>()

function tooManyAttempts(ip: string): boolean {
  const entry = attempts.get(ip)
  if (!entry || Date.now() > entry.resetAt) return false
  return entry.count >= RATE_LIMIT_MAX
}

function recordAttempt(ip: string): void {
  const now = Date.now()
  const entry = attempts.get(ip)
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return
  }
  entry.count++
  if (attempts.size > 5000) {
    for (const [k, v] of Array.from(attempts.entries())) {
      if (now > v.resetAt) attempts.delete(k)
    }
  }
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-real-ip')?.trim()
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown'

  if (tooManyAttempts(ip)) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again in 15 minutes.' },
      { status: 429 },
    )
  }

  const { email, code, password } = await request.json().catch(() => ({})) as {
    email?: unknown; code?: unknown; password?: unknown
  }

  if (typeof email !== 'string' || typeof code !== 'string' || typeof password !== 'string'
      || !email || !code || !password) {
    return NextResponse.json({ error: 'Email, code, and password are required' }, { status: 400 })
  }

  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }
  // bcrypt silently ignores anything past 72 bytes, so a longer passphrase would
  // be quietly truncated and a shorter prefix would unlock the account. Reject
  // rather than truncate. Note this is BYTES: multi-byte characters count more
  // than once, so ~18 emoji already reach the limit.
  if (passwordTooLong(password)) {
    return NextResponse.json(
      { error: `Password is too long — it must be ${MAX_PASSWORD_BYTES} bytes or fewer (roughly ${MAX_PASSWORD_BYTES} characters, fewer if you use emoji or accents).` },
      { status: 400 },
    )
  }

  const db  = createAdminClient()
  const now = new Date().toISOString()

  const { data: user } = await db
    .from('users')
    .select('id, email, name')
    .eq('email', email.toLowerCase().trim())
    .eq('is_active', true)
    .maybeSingle()

  if (!user) {
    recordAttempt(ip)
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })
  }

  const { data: record } = await db
    .from('password_reset_tokens')
    .select('id')
    .eq('user_id', user.id)
    .eq('token_hash', hashResetCode(code))
    .is('used_at', null)
    .gt('expires_at', now)
    .maybeSingle()

  if (!record) {
    recordAttempt(ip)
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })
  }

  // Burn the code FIRST, and only proceed if this request is the one that burned
  // it. Writing the password first left a window where two concurrent requests
  // with the same code could both succeed, and a failure after the password write
  // would leave a still-valid code behind.
  const { data: burned, error: burnErr } = await db
    .from('password_reset_tokens')
    .update({ used_at: now })
    .eq('id', record.id)
    .is('used_at', null)
    .select('id')

  if (burnErr) {
    console.error('[reset-password] could not consume the code:', burnErr.message)
    return NextResponse.json({ error: 'Could not complete the reset. Try again.' }, { status: 500 })
  }
  if (!burned || burned.length === 0) {
    recordAttempt(ip)
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })
  }

  const { error: pwErr } = await db
    .from('users')
    .update({
      password_hash:       hashPasswordSecure(password),
      // Clears the forced rotation. This is the only path that does, which is
      // what guarantees a flagged account ends up on a bcrypt hash.
      must_reset_password: false,
      password_changed_at: now,
    })
    .eq('id', user.id)

  if (pwErr) {
    console.error('[reset-password] password write failed:', pwErr.message)
    return NextResponse.json({ error: 'Could not save the new password. Try again.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
