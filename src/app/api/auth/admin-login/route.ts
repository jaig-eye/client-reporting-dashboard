// Admin login — supports two modes:
//   1. Super admin: email blank, password = ADMIN_PASSWORD env var + email OTP
//   2. Regular admin: email + password verified against users table (bcrypt)

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { timingSafeCompare, verifyPassword } from '@/lib/auth'
import { signAdminSession } from '@/lib/session'
import { logActivity } from '@/lib/activity'
import { sendEmail, isEmailConfigured } from '@/lib/email'
import { issueResetCode } from '@/lib/passwordReset'
import type { SupabaseClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  maxAge: 60 * 60 * 24 * 14,
  path: '/',
}

// ── Per-IP rate limit: 5 FAILURES per 15 minutes ─────────────────────────────
//
// In-memory, and therefore per serverless instance — the same limitation main
// has always had. A database-backed version was tried on the security branch and
// was strictly worse in practice: it failed OPEN on any query error, and its
// table (migration 194) is not applied, so every call took the error branch and
// the endpoint had no rate limiting at all. An imperfect limiter that works
// beats a durable one that is inert. Moving this to Postgres is worth doing on
// its own, with the migration applied first and failing CLOSED.
//
// Only FAILURES consume budget: a clean super-admin login is two POSTs (password,
// then OTP), so counting every request burned 2 of 5 slots on success, and
// colleagues behind one office NAT could lock each other out without ever
// mistyping anything.
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
const failedAttempts = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(ip: string): boolean {
  const entry = failedAttempts.get(ip)
  if (!entry || Date.now() > entry.resetAt) return true
  return entry.count < RATE_LIMIT_MAX
}

function recordFailedAttempt(ip: string): void {
  const now = Date.now()
  const entry = failedAttempts.get(ip)
  if (!entry || now > entry.resetAt) {
    failedAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return
  }
  entry.count++
  // Opportunistic sweep so one instance cannot accumulate an entry per attacker IP
  // for the lifetime of the process.
  if (failedAttempts.size > 5000) {
    for (const [k, v] of Array.from(failedAttempts.entries())) {
      if (now > v.resetAt) failedAttempts.delete(k)
    }
  }
}

function resetRateLimit(ip: string): void {
  failedAttempts.delete(ip)
}

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
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const db = createAdminClient()

  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again in 15 minutes.' },
      { status: 429 }
    )
  }

  const { email, password, code } = await request.json()

  if (!password) {
    return NextResponse.json({ error: 'Password required' }, { status: 400 })
  }

  // ── Super admin path ────────────────────────────────────────────────────────
  if (!email || email.trim() === '') {
    if (!timingSafeCompare(password, process.env.ADMIN_PASSWORD ?? '')) {
      recordFailedAttempt(ip)
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
        recordFailedAttempt(ip)
        return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 })
      }

      // Clear OTP after use
      await db.from('agency_settings').update({
        super_admin_otp_hash:       null,
        super_admin_otp_expires_at: null,
      })

      resetRateLimit(ip)
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

  const USER_COLS = 'id, role, password_hash, is_active, email, name, must_reset_password'
  const { data: user } = isEmail
    ? await db.from('users').select(USER_COLS)
        .eq('email', identifier).eq('is_active', true).maybeSingle()
    : await db.from('users').select(USER_COLS)
        .ilike('username', identifier).eq('is_active', true).maybeSingle()

  // verifyPassword equalizes timing when no user/hash exists (dummy bcrypt compare).
  const { ok: hashMatch, needsUpgrade } = verifyPassword(password, user?.password_hash)
  if (!user || !hashMatch) {
    recordFailedAttempt(ip)
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
    // Not fire-and-forget: if the mail does not leave, blocking the login is a
    // lockout, so the caller has to be told the difference.
    const issued = await issueResetCode(db, { id: user.id, email: user.email }, { reason: 'forced' })
    resetRateLimit(ip)

    if (!issued.ok) {
      console.error('[admin-login] forced reset could not send a code:', issued.reason, issued.detail ?? '')
      return NextResponse.json(
        {
          resetRequired: true,
          emailSent:     false,
          error: issued.reason === 'email_not_configured'
            ? 'Your password must be reset, but email is not configured on this server so a code could not be sent. Contact your administrator.'
            : 'Your password must be reset, but the code could not be emailed. Try again in a moment or contact your administrator.',
        },
        { status: 503 },
      )
    }

    logActivity(
      { isSuperAdmin: false, userId: user.id, name: user.name ?? undefined, email: user.email },
      'password_reset_required', 'user', { resourceId: user.id, meta: { email: user.email, ip } },
    )

    return NextResponse.json(
      {
        resetRequired: true,
        emailSent:     true,
        email:         user.email,
        message:       'Your password needs to be updated. We have emailed you a reset code.',
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
    { isSuperAdmin: false, userId: user.id, name: user.name ?? undefined, email: user.email },
    'logged_in', 'user', { resourceId: user.id, meta: { email: user.email, ip } }
  )

  resetRateLimit(ip)
  const res = NextResponse.json({ ok: true, role: user.role })
  // admin_session carries the SIGNED identity; admin_user_id remains only as a
  // non-authoritative display hint (authorization no longer trusts it).
  res.cookies.set('admin_session', signAdminSession({ isSuperAdmin: false, userId: user.id, role: user.role }), COOKIE_OPTS)
  res.cookies.set('admin_user_id', user.id, COOKIE_OPTS)
  return res
}
