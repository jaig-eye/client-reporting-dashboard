// POST /api/auth/reset-password
// Step 2 of code-based password reset.
// Body: { email: string; code: string; password: string }

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { hashPasswordSecure, passwordTooLong, MAX_PASSWORD_BYTES } from '@/lib/auth'
import { hashResetCode } from '@/lib/passwordReset'
import { createRateLimiter, clientIp } from '@/lib/rateLimit'

// Per-IP limit on CODE VERIFICATION. This endpoint had none: six digits
// (~9x10^5) with a ten-minute life, no attempt counter on the token, and a hit
// rewrites the password outright — a straight path to account takeover that also
// locks the owner out. forgot-password limits only ISSUANCE, which does nothing
// to slow guessing against a code already sent.
const resetLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 })

export async function POST(request: NextRequest) {
  const ip = clientIp(request)

  // take() reserves the attempt up front, so a burst of concurrent guesses cannot
  // all read the same pre-increment count.
  if (!resetLimiter.take(ip)) {
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
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })
  }

  // must_reset_password / password_changed_at only exist from migration 195. If
  // the code shipped ahead of the migration, writing them fails — and because the
  // code above is already burned, the user would be left with the OLD password
  // and NO usable code, i.e. locked out by deploy ordering. Retry without those
  // columns so the password still changes; the flag simply does not exist yet.
  let { error: pwErr } = await db
    .from('users')
    .update({
      password_hash:       hashPasswordSecure(password),
      // Clears the forced rotation. This is the only self-service path that does,
      // which is what guarantees a flagged account ends up on a bcrypt hash.
      must_reset_password: false,
      password_changed_at: now,
    })
    .eq('id', user.id)

  if (pwErr && /must_reset_password|password_changed_at/i.test(pwErr.message)) {
    console.warn('[reset-password] rotation columns missing (migration 195 not applied) — writing the password only')
    ;({ error: pwErr } = await db
      .from('users')
      .update({ password_hash: hashPasswordSecure(password) })
      .eq('id', user.id))
  }

  if (pwErr) {
    // Hand the code back. It was burned before the write specifically so two
    // concurrent requests could not both succeed, but that makes a failed write a
    // lockout unless the code is restored — every retry would otherwise answer
    // "Invalid or expired code", and a flagged account has no session to fall
    // back on.
    await db.from('password_reset_tokens')
      .update({ used_at: null })
      .eq('id', record.id)
      .then(null, () => {})

    console.error('[reset-password] password write failed:', pwErr.message)
    return NextResponse.json({ error: 'Could not save the new password. Try again with the same code.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
