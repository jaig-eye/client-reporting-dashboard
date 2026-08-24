// Admin login — supports two modes:
//   1. Super admin: email blank, password = ADMIN_PASSWORD env var + email OTP
//   2. Regular admin: email + password verified against users table (bcrypt)

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { timingSafeCompare, verifyPassword, hashPasswordSecure } from '@/lib/auth'
import { signAdminSession } from '@/lib/session'
import { logActivity } from '@/lib/activity'
import { sendEmail, isEmailConfigured } from '@/lib/email'
import type { SupabaseClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  maxAge: 60 * 60 * 24 * 14,
  path: '/',
}

// Durable per-IP rate limit (5 attempts / 15 min) backed by the login_attempts table,
// so it holds across serverless instances (an in-memory Map did not). Fails open only
// if the table is unreachable, logging loudly.
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000

async function checkRateLimit(db: SupabaseClient, ip: string): Promise<boolean> {
  try {
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()
    const { count, error } = await db
      .from('login_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('ip', ip)
      .gte('created_at', windowStart)
    // supabase-js RESOLVES with an { error } instead of throwing, so without this check a
    // missing table (i.e. migration 194 not applied yet) silently made the limiter inert:
    // count would be null, `0 >= MAX` false, and the insert would fail unnoticed.
    if (error) {
      console.error('[admin-login] rate-limit store unavailable, failing open:', error.message)
      return true
    }
    return (count ?? 0) < RATE_LIMIT_MAX
  } catch (e) {
    console.error('[admin-login] rate-limit store threw, failing open:', e)
    return true
  }
}

/** Record a FAILED attempt. Only failures consume the budget — counting every request meant
 *  a clean super-admin login (password + OTP = 2 POSTs) burned 2 of 5 slots, and admins
 *  sharing an office NAT could lock each other out without ever mistyping a password. */
async function recordFailedAttempt(db: SupabaseClient, ip: string): Promise<void> {
  try {
    const { error } = await db.from('login_attempts').insert({ ip })
    if (error) console.error('[admin-login] rate-limit insert failed:', error.message)
  } catch { /* never block a login response on the limiter */ }
}

async function resetRateLimit(db: SupabaseClient, ip: string): Promise<void> {
  try {
    await db.from('login_attempts').delete().eq('ip', ip)
  } catch { /* best-effort */ }
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

  if (!(await checkRateLimit(db, ip))) {
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
      await recordFailedAttempt(db, ip)
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
        await recordFailedAttempt(db, ip)
        return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 })
      }

      // Clear OTP after use
      await db.from('agency_settings').update({
        super_admin_otp_hash:       null,
        super_admin_otp_expires_at: null,
      })

      await resetRateLimit(db, ip)
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

  const { data: user } = isEmail
    ? await db.from('users').select('id, role, password_hash, is_active, email, name')
        .eq('email', identifier).eq('is_active', true).maybeSingle()
    : await db.from('users').select('id, role, password_hash, is_active, email, name')
        .ilike('username', identifier).eq('is_active', true).maybeSingle()

  // verifyPassword equalizes timing when no user/hash exists (dummy bcrypt compare).
  const { ok: hashMatch, needsUpgrade } = verifyPassword(password, user?.password_hash)
  if (!user || !hashMatch) {
    await recordFailedAttempt(db, ip)
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  // Upgrade legacy SHA-256 hashes to bcrypt on successful login (fire-and-forget).
  if (needsUpgrade) {
    db.from('users').update({ password_hash: hashPasswordSecure(password) }).eq('id', user.id)
  }

  // Record login time (fire-and-forget)
  db.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id)

  logActivity(
    { isSuperAdmin: false, userId: user.id, name: user.name ?? undefined, email: user.email },
    'logged_in', 'user', { resourceId: user.id, meta: { email: user.email, ip } }
  )

  await resetRateLimit(db, ip)
  const res = NextResponse.json({ ok: true, role: user.role })
  // admin_session carries the SIGNED identity; admin_user_id remains only as a
  // non-authoritative display hint (authorization no longer trusts it).
  res.cookies.set('admin_session', signAdminSession({ isSuperAdmin: false, userId: user.id, role: user.role }), COOKIE_OPTS)
  res.cookies.set('admin_user_id', user.id, COOKIE_OPTS)
  return res
}
