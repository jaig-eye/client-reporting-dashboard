// POST /api/auth/forgot-password
// Step 1 of code-based password reset.
// Always returns 200 — never reveals whether the email exists.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email'
import { createHash, randomInt } from 'crypto'

function generateCode(): string {
  return String(randomInt(100000, 999999))
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

export async function POST(request: NextRequest) {
  const { email } = await request.json() as { email?: string }

  if (!email?.trim()) return NextResponse.json({ ok: true })

  const db         = createAdminClient()
  const identifier = email.toLowerCase().trim()

  const { data: user } = await db
    .from('users')
    .select('id, email')
    .eq('email', identifier)
    .eq('is_active', true)
    .maybeSingle()

  if (!user) return NextResponse.json({ ok: true })

  // Invalidate any prior unused tokens
  await db
    .from('password_reset_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('used_at', null)

  const code      = generateCode()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 min

  await db.from('password_reset_tokens').insert({
    user_id:    user.id,
    token_hash: hashCode(code),
    expires_at: expiresAt,
  })

  const { data: settings } = await db
    .from('agency_settings')
    .select('agency_name')
    .single()

  const agencyName = (settings as { agency_name?: string } | null)?.agency_name ?? 'Agency Dashboard'

  try {
    await sendEmail({
      to:      user.email,
      subject: `${agencyName} — Your password reset code`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:400px;margin:0 auto;padding:32px 24px;">
          <h2 style="font-size:18px;font-weight:700;color:#111827;margin:0 0 8px;">Password reset code</h2>
          <p style="font-size:14px;color:#6b7280;margin:0 0 24px;">Enter this code on the reset page. It expires in 10 minutes.</p>
          <div style="background:#f3f4f6;border-radius:8px;padding:20px;text-align:center;letter-spacing:0.2em;font-size:32px;font-weight:700;color:#111827;font-family:monospace;">
            ${code}
          </div>
          <p style="font-size:12px;color:#9ca3af;margin:20px 0 0;">If you didn't request this, ignore this email — your password hasn't changed.</p>
        </div>`,
    })
  } catch (e) {
    console.error('[forgot-password] email send failed:', e)
  }

  return NextResponse.json({ ok: true })
}
