// Admin login — supports two modes:
//   1. Super admin: email blank, password = ADMIN_PASSWORD env var + email OTP
//   2. Regular admin: email + password verified against users table

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { hashPassword } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { sendEmail, isEmailConfigured } from '@/lib/email'
import crypto from 'crypto'

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  maxAge: 60 * 60 * 24 * 14,
  path: '/',
}

// In-memory rate limit: 5 attempts per IP per 15 minutes
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000

function checkRateLimit(ip: string): boolean {
  const now   = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

function resetRateLimit(ip: string): void {
  rateLimitMap.delete(ip)
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
  res.cookies.set('admin_session', process.env.ADMIN_PASSWORD!, COOKIE_OPTS)
  res.cookies.delete('admin_user_id')
  return res
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
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
    if (password !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
    }

    const db = createAdminClient()

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
        hashOtp(String(code)) !== storedHash
      ) {
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

    // If email isn't configured at all, OTP can never be delivered — skip 2FA
    // entirely rather than locking the super admin out.
    if (!isEmailConfigured()) {
      console.warn('[admin-login] MAILGUN_SMTP_* not configured — bypassing super admin 2FA')
      logActivity(
        { isSuperAdmin: true }, 'logged_in_no_2fa', 'user',
        { meta: { ip, reason: 'email_not_configured' } }
      )
      resetRateLimit(ip)
      return superAdminSessionResponse()
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
  const db         = createAdminClient()
  const identifier = email.toLowerCase().trim()
  const isEmail    = identifier.includes('@')

  const { data: user } = isEmail
    ? await db.from('users').select('id, role, password_hash, is_active, email, name')
        .eq('email', identifier).eq('is_active', true).maybeSingle()
    : await db.from('users').select('id, role, password_hash, is_active, email, name')
        .ilike('username', identifier).eq('is_active', true).maybeSingle()

  if (!user || user.password_hash !== hashPassword(password)) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  // Record login time (fire-and-forget)
  db.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id)

  logActivity(
    { isSuperAdmin: false, userId: user.id, name: user.name ?? undefined, email: user.email },
    'logged_in', 'user', { resourceId: user.id, meta: { email: user.email, ip } }
  )

  resetRateLimit(ip)
  const res = NextResponse.json({ ok: true, role: user.role })
  res.cookies.set('admin_session', process.env.ADMIN_PASSWORD!, COOKIE_OPTS)
  res.cookies.set('admin_user_id', user.id, COOKIE_OPTS)
  return res
}
