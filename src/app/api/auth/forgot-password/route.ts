// POST /api/auth/forgot-password
// Always returns 200 — never reveals whether the email exists.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email'
import { buildPasswordResetEmail } from '@/lib/content/emailTemplates'
import { randomBytes, createHash } from 'crypto'

export async function POST(request: NextRequest) {
  const { email } = await request.json() as { email?: string }

  if (!email?.trim()) {
    return NextResponse.json({ ok: true })
  }

  const db          = createAdminClient()
  const identifier  = email.toLowerCase().trim()

  const { data: user } = await db
    .from('users')
    .select('id, email')
    .eq('email', identifier)
    .eq('is_active', true)
    .maybeSingle()

  if (!user) {
    return NextResponse.json({ ok: true })
  }

  // Invalidate any prior unused tokens
  await db
    .from('password_reset_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('used_at', null)

  // Generate new token
  const rawToken  = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()

  await db.from('password_reset_tokens').insert({
    user_id:    user.id,
    token_hash: tokenHash,
    expires_at: expiresAt,
  })

  const { data: settings } = await db
    .from('agency_settings')
    .select('agency_name')
    .single()

  const agencyName = (settings as { agency_name?: string } | null)?.agency_name ?? 'Agency Dashboard'
  const appUrl     = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  const resetLink  = `${appUrl}/admin/reset-password?token=${rawToken}`

  try {
    await sendEmail({
      to:      user.email,
      subject: `${agencyName} | Reset your password`,
      html:    buildPasswordResetEmail({ agencyName, resetLink }),
    })
  } catch (e) {
    console.error('[forgot-password] email send failed:', e)
  }

  return NextResponse.json({ ok: true })
}
