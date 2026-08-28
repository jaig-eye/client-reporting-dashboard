// POST /api/auth/reset-password
// Step 2 of code-based password reset.
// Body: { email: string; code: string; password: string }

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { hashPasswordSecure, passwordTooLong, MAX_PASSWORD_BYTES } from '@/lib/auth'
import { hashResetCode } from '@/lib/passwordReset'
import { createRateLimiter, clientIp } from '@/lib/rateLimit'
import { timingSafeEqual } from 'crypto'

// Per-IP limit on CODE VERIFICATION. This is the FIRST of two throttles: the
// per-IP limiter here slows a single source, and the per-TOKEN attempt cap below
// (idx via migration 197) bounds total guesses against one code no matter how
// many IPs or serverless instances the attacker spreads across. Either alone is
// weak — six digits (~9x10^5) with a ten-minute life and a hit that rewrites the
// password is a straight path to account takeover — so both apply.
const resetLimiter = createRateLimiter({ name: 'reset', max: 10, windowMs: 15 * 60 * 1000 })

// Guesses allowed against one issued code before it is burned. After this the
// attacker must trigger a fresh (randomly different) code, and issuance is itself
// IP-rate-limited on forgot-password.
const MAX_RESET_ATTEMPTS = 5

export async function POST(request: NextRequest) {
  const ip = clientIp(request)

  // take() reserves the attempt up front, so a burst of concurrent guesses cannot
  // all read the same pre-increment count.
  if (!(await resetLimiter.take(ip))) {
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

  // Look up the user's LIVE code by user_id — NOT by the submitted hash. There is
  // at most one (issueResetCode invalidates prior codes). Matching on user_id is
  // what lets a WRONG guess still find the token and spend one of its attempts;
  // the old shape matched on token_hash, so a wrong code found no row and cost the
  // attacker nothing, leaving the six-digit space open to distributed guessing.
  const { data: token } = await db
    .from('password_reset_tokens')
    .select('id, token_hash')
    .eq('user_id', user.id)
    .is('used_at', null)
    .gt('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!token) {
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })
  }

  const submitted = hashResetCode(code)
  const stored    = String(token.token_hash)
  const codeOk =
    submitted.length === stored.length &&
    timingSafeEqual(Buffer.from(submitted), Buffer.from(stored))

  if (!codeOk) {
    // Charge the guess to the TOKEN atomically (migration 207 RPC: `attempts =
    // attempts + 1 ... RETURNING`, burning the code at MAX_RESET_ATTEMPTS). A
    // client-side read-modify-write would lose updates under concurrency and never
    // reach the cap, so K parallel guesses would only advance the counter by 1.
    // Swallowed if the RPC/column is not deployed yet — the per-IP limiter still applies.
    await db.rpc('consume_reset_attempt', { p_token_id: token.id, p_max: MAX_RESET_ATTEMPTS }).then(null, () => {})
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })
  }

  // Correct code — burn it FIRST, and only proceed if this request is the one that
  // burned it. Writing the password first left a window where two concurrent
  // requests with the same code could both succeed, and a failure after the
  // password write would leave a still-valid code behind.
  const { data: burned, error: burnErr } = await db
    .from('password_reset_tokens')
    .update({ used_at: now })
    .eq('id', token.id)
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
      password_hash:       await hashPasswordSecure(password),
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
      .update({ password_hash: await hashPasswordSecure(password) })
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
      .eq('id', token.id)
      .then(null, () => {})

    console.error('[reset-password] password write failed:', pwErr.message)
    return NextResponse.json({ error: 'Could not save the new password. Try again with the same code.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
