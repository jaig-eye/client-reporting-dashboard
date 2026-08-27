// Admin login — supports two modes:
//   1. Super admin: email blank, password = ADMIN_PASSWORD env var + email OTP
//   2. Regular admin: email + password verified against users table (bcrypt)

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { timingSafeCompare, verifyPassword } from '@/lib/auth'
import { signAdminSession, sessionSigningConfigured } from '@/lib/session'
import { logActivity } from '@/lib/activity'
import { sendEmail, isEmailConfigured } from '@/lib/email'
import { issueResetCode } from '@/lib/passwordReset'
import { createRateLimiter, clientIp } from '@/lib/rateLimit'
import type { SupabaseClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  maxAge: 60 * 60 * 24 * 14,
  path: '/',
}

// Per-IP limit, shared implementation. take() reserves an attempt at request
// ENTRY — the count and the check are one synchronous step, so a concurrent burst
// cannot all slip through the way it could when the increment sat after ~0.5s of
// awaits. A successful sign-in calls reset(), so the two POSTs a clean super-admin
// login costs (password, then OTP) leave no residue, and colleagues behind one
// office NAT do not lock each other out.
const loginLimiter = createRateLimiter({ max: 5, windowMs: 15 * 60 * 1000 })

const SUPER_ADMIN_EMAIL = 'support@golaunchlocal.com'
const OTP_TTL_MINUTES   = 10

function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex')
}

function generateOtp(): string {
  return String(crypto.randomInt(100000, 999999))
}

function superAdminSessionResponse(): NextResponse {
  const res = NextResponse.json({ ok: true, role: 'super_admin' })
  res.cookies.set('admin_session', signAdminSession({ isSuperAdmin: true }), COOKIE_OPTS)
  res.cookies.delete('admin_user_id')
  return res
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request)
  const db = createAdminClient()

  // Checked BEFORE any credential work. signAdminSession throws when
  // SESSION_SECRET is unset in production, and that throw lands at the very END
  // of this handler — after the one-time OTP has already been consumed, after
  // last_login_at is written, and after a 'logged_in' activity row is recorded
  // for a login that never happened. Every retry then burned a fresh emailed
  // code and produced the same opaque 500, with nothing naming the real cause.
  if (!sessionSigningConfigured()) {
    console.error('[admin-login] SESSION_SECRET is not set — cannot issue sessions. Generate one with `openssl rand -hex 32`.')
    return NextResponse.json(
      { error: 'Sign-in is not configured on this server (missing session secret). Contact your administrator.' },
      { status: 503 },
    )
  }

  if (!loginLimiter.take(ip)) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again in 15 minutes.' },
      { status: 429 }
    )
  }

  // Guarded parse. An unparseable body, a null body, or a non-string email/password
  // previously threw — SyntaxError from JSON.parse, a destructure error on null,
  // `email.trim is not a function`, or bcryptjs's "Illegal arguments" — producing a
  // 500 and, because the throw happened before any failure was recorded, a probe
  // that cost the attacker nothing and left no trace.
  const body = await request.json().catch(() => null) as
    { email?: unknown; password?: unknown; code?: unknown } | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const email    = typeof body.email === 'string' ? body.email : ''
  const password = body.password
  const code     = body.code

  if (!password || typeof password !== 'string') {
    return NextResponse.json({ error: 'Password required' }, { status: 400 })
  }

  // ── Super admin path ────────────────────────────────────────────────────────
  if (!email || email.trim() === '') {
    if (!timingSafeCompare(password, process.env.ADMIN_PASSWORD ?? '')) {
      // No second take(): the attempt was already reserved at request entry.
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
    }

    // Step 2 — verify OTP
    if (code) {
      const { data: settings } = await db
        .from('agency_settings')
        .select('super_admin_otp_hash, super_admin_otp_expires_at, agency_name')
        .single()

      const storedHash = (settings as Record<string, unknown> | null)?.super_admin_otp_hash as string | null
      const expiresAt  = (settings as Record<string, unknown> | null)?.super_admin_otp_expires_at as string | null

      if (
        !storedHash ||
        !expiresAt ||
        new Date(expiresAt) < new Date() ||
        !crypto.timingSafeEqual(Buffer.from(hashOtp(String(code)), 'hex'), Buffer.from(storedHash, 'hex'))
      ) {
        return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 })
      }

      // Clear OTP after use
      await db.from('agency_settings').update({
        super_admin_otp_hash:       null,
        super_admin_otp_expires_at: null,
      })

      loginLimiter.reset(ip)
      return superAdminSessionResponse()
    }

    // If email isn't configured, OTP cannot be delivered — block login rather than
    // downgrading to single-factor auth. Fix MAILGUN_SMTP_* env vars to proceed.
    if (!isEmailConfigured()) {
      console.error('[admin-login] MAILGUN_SMTP_* not configured — super admin login blocked')
      return NextResponse.json(
        { error: 'Email delivery is not configured. Contact your system administrator.' },
        { status: 503 }
      )
    }

    // Step 1 — password correct, generate and email OTP
    const otp        = generateOtp()
    const expiresAt  = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString()

    const { data: settings } = await db
      .from('agency_settings')
      .select('agency_name')
      .single()
    const agencyName = (settings as { agency_name?: string } | null)?.agency_name ?? 'Agency Dashboard'

    await db.from('agency_settings').update({
      super_admin_otp_hash:       hashOtp(otp),
      super_admin_otp_expires_at: expiresAt,
    })

    try {
      await sendEmail({
        to:      SUPER_ADMIN_EMAIL,
        subject: `${agencyName} — Your login code`,
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:400px;margin:0 auto;padding:32px 24px;">
            <h2 style="font-size:18px;font-weight:700;color:#111827;margin:0 0 8px;">Your sign-in code</h2>
            <p style="font-size:14px;color:#6b7280;margin:0 0 24px;">Use this code to complete your super admin sign-in. It expires in ${OTP_TTL_MINUTES} minutes.</p>
            <div style="background:#f3f4f6;border-radius:8px;padding:20px;text-align:center;letter-spacing:0.2em;font-size:32px;font-weight:700;color:#111827;font-family:monospace;">
              ${otp}
            </div>
            <p style="font-size:12px;color:#9ca3af;margin:20px 0 0;">If you didn't request this, someone else knows your master password — change it immediately.</p>
          </div>`,
      })
    } catch (e) {
      // Delivery failed — clear the stored OTP (it can't be delivered) and return
      // an error. Do NOT bypass 2FA: a misconfigured SMTP is not a valid auth factor.
      console.error('[admin-login] OTP email failed:', e)
      await db.from('agency_settings').update({
        super_admin_otp_hash:       null,
        super_admin_otp_expires_at: null,
      })
      return NextResponse.json(
        { error: 'Failed to send verification code. Please try again.' },
        { status: 503 }
      )
    }

    return NextResponse.json({ step: 'code' })
  }

  // ── Regular user path: email or username + password ───────────────────────
  const identifier = email.toLowerCase().trim()
  const isEmail    = identifier.includes('@')

  // The error is CHECKED, and the missing-column case degrades instead of failing.
  //
  // must_reset_password only exists from migration 195. Migrations here are
  // applied by hand, so code can reach production first — and a discarded
  // PostgREST error would make `user` null and answer "Invalid credentials" to a
  // correct password for every admin, with nothing logged. That is a total
  // lockout caused purely by deploy ordering.
  //
  // Falling back to the column list that exists on every environment keeps login
  // working, and costs nothing in safety: every account the flag would have
  // caught is a legacy SHA-256 hash, which `needsUpgrade` below forces to rotate
  // regardless of the flag.
  const BASE_COLS  = 'id, role, password_hash, is_active, email, name'
  const FULL_COLS  = `${BASE_COLS}, must_reset_password`

  async function lookup(cols: string) {
    return isEmail
      ? await db.from('users').select(cols)
          .eq('email', identifier).eq('is_active', true).maybeSingle()
      : await db.from('users').select(cols)
          .ilike('username', identifier).eq('is_active', true).maybeSingle()
  }

  let { data: userRow, error: lookupErr } = await lookup(FULL_COLS)
  if (lookupErr && /must_reset_password/i.test(lookupErr.message)) {
    console.warn('[admin-login] must_reset_password column missing (migration 195 not applied) — falling back; legacy hashes still force a rotation')
    ;({ data: userRow, error: lookupErr } = await lookup(BASE_COLS))
  }
  if (lookupErr) {
    console.error('[admin-login] user lookup failed:', lookupErr.message)
    return NextResponse.json(
      { error: 'Sign-in is temporarily unavailable. Please try again shortly.' },
      { status: 503 },
    )
  }

  const user = userRow as unknown as {
    id: string; role: string | null; password_hash: string | null
    is_active: boolean; email: string | null; name: string | null
    must_reset_password?: boolean
  } | null

  // verifyPassword equalizes timing when no user/hash exists (dummy bcrypt compare).
  const { ok: hashMatch, needsUpgrade } = verifyPassword(password, user?.password_hash)
  if (!user || !hashMatch) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  // ── Forced rotation ────────────────────────────────────────────────────────
  //
  // The password was correct — that is what proves it is them — but a flagged
  // account gets NO session. Two conditions force it: the explicit flag, and any
  // surviving legacy SHA-256 hash. The second is belt-and-braces: it means an
  // unsalted hash can never mint a session even if the flag was missed, so once
  // everyone has rotated the legacy branch in verifyPassword becomes dead code
  // we can delete outright rather than support forever.
  const mustReset = user.must_reset_password === true || needsUpgrade
  if (mustReset) {
    // An account with no email address cannot be rotated this way, and issuing a
    // code would throw inside nodemailer ("No recipients defined") and read as a
    // transient failure the user is invited to retry forever. Say what is wrong.
    if (!user.email) {
      return NextResponse.json(
        {
          resetRequired: true,
          emailSent:     false,
          error: 'Your password must be updated, but this account has no email address on file so a code cannot be sent. Ask an administrator to set one.',
        },
        { status: 409 },
      )
    }

    // Re-use a live code instead of minting a new one on every attempt.
    //
    // issueResetCode invalidates all outstanding codes for the user, so an
    // unconditional call here meant: user reads code A from their inbox, clicks
    // Sign in once more, code A is silently killed and code B is sent, and code A
    // now fails. Repeatedly clicking Sign in was also an unmetered mail-bomb, one
    // ~1s bcrypt compare per click.
    const { data: liveCode } = await db
      .from('password_reset_tokens')
      .select('id')
      .eq('user_id', user.id)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .limit(1)
      .maybeSingle()

    const issued = liveCode
      ? { ok: true as const }
      // Not fire-and-forget: if the mail does not leave, blocking the login is a
      // lockout, so the caller has to be told the difference.
      : await issueResetCode(db, { id: user.id, email: user.email ?? undefined }, { reason: 'forced' })

    if (!issued.ok) {
      console.error('[admin-login] forced reset could not send a code:', issued.reason, issued.detail ?? '')
      return NextResponse.json(
        {
          resetRequired: true,
          emailSent:     false,
          email:         user.email,
          error: issued.reason === 'email_not_configured'
            ? 'Your password must be reset, but email is not configured on this server so a code could not be sent. Contact your administrator.'
            : 'Your password must be reset, but the code could not be emailed. Try again in a moment or contact your administrator.',
        },
        { status: 503 },
      )
    }

    // The rate limit is cleared only once the user is genuinely through the
    // password check AND has a usable code — clearing it before the outcome was
    // known made this whole branch unmetered.
    loginLimiter.reset(ip)

    logActivity(
      { isSuperAdmin: false, userId: user.id, name: user.name ?? undefined, email: user.email ?? undefined },
      'password_reset_required', 'user', { resourceId: user.id, meta: { email: user.email, ip } },
    )

    return NextResponse.json(
      {
        resetRequired: true,
        emailSent:     true,
        reusedCode:    Boolean(liveCode),
        email:         user.email,
        // `error` as well as `message`: the login page renders `data.error`, so a
        // body carrying only `message` fell through to "Invalid credentials" and
        // told every admin their correct password was wrong.
        error:   liveCode
          ? 'Your password needs to be updated. Use the code we already emailed you — check your inbox.'
          : 'Your password needs to be updated. We have emailed you a reset code.',
        message: liveCode
          ? 'Your password needs to be updated. Use the code we already emailed you.'
          : 'Your password needs to be updated. We have emailed you a reset code.',
      },
      { status: 403 },
    )
  }

  // Record login time. Awaited, unlike the "fire-and-forget" version this
  // replaces: a supabase-js builder is a lazy thenable, so the un-awaited call
  // issued no request at all — which is why last_login_at is NULL for every user
  // in the database despite people logging in for months.
  const { error: loginStampErr } = await db
    .from('users')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', user.id)
  if (loginStampErr) console.error('[admin-login] last_login_at write failed:', loginStampErr.message)

  logActivity(
    { isSuperAdmin: false, userId: user.id, name: user.name ?? undefined, email: user.email ?? undefined },
    'logged_in', 'user', { resourceId: user.id, meta: { email: user.email, ip } }
  )

  loginLimiter.reset(ip)
  const res = NextResponse.json({ ok: true, role: user.role })
  // admin_session carries the SIGNED identity; admin_user_id remains only as a
  // non-authoritative display hint (authorization no longer trusts it).
  res.cookies.set('admin_session', signAdminSession({ isSuperAdmin: false, userId: user.id, role: user.role ?? undefined }), COOKIE_OPTS)
  res.cookies.set('admin_user_id', user.id, COOKIE_OPTS)
  return res
}
