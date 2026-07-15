// POST /api/auth/client-resend
// Regenerates and resends the IP-change OTP to the client's email address.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email'
import { getAgencySettings } from '@/lib/agency-settings'
import crypto from 'crypto'

const OTP_TTL_MINUTES = 10

function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex')
}

function generateOtp(): string {
  return String(crypto.randomInt(100000, 999999))
}

export async function POST() {
  const cookieStore = await cookies()
  const clientToken = cookieStore.get('client_token')?.value

  if (!clientToken) {
    return NextResponse.json({ error: 'Session expired' }, { status: 401 })
  }

  const db = createAdminClient()

  const { data: client } = await db
    .from('clients')
    .select('id, email, name')
    .eq('dashboard_token', clientToken)
    .maybeSingle()

  if (!client) {
    return NextResponse.json({ error: 'Session invalid' }, { status: 401 })
  }

  const row = client as unknown as { id: string; email: string | null; name: string | null }

  if (!row.email) {
    return NextResponse.json({ error: 'No email on file' }, { status: 400 })
  }

  const otp       = generateOtp()
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString()

  await db.from('clients').update({
    client_otp_hash:       hashOtp(otp),
    client_otp_expires_at: expiresAt,
  }).eq('id', row.id)

  const settings   = await getAgencySettings() as unknown as Record<string, unknown>
  const agencyName = (settings?.agency_name as string | null) ?? 'Agency Dashboard'

  try {
    await sendEmail({
      to:      row.email,
      subject: `${agencyName} — Your verification code`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:400px;margin:0 auto;padding:32px 24px;">
          <h2 style="font-size:18px;font-weight:700;color:#111827;margin:0 0 8px;">Your verification code</h2>
          <p style="font-size:14px;color:#6b7280;margin:0 0 24px;">Use this code to verify your new sign-in location. It expires in ${OTP_TTL_MINUTES} minutes.</p>
          <div style="background:#f3f4f6;border-radius:8px;padding:20px;text-align:center;letter-spacing:0.2em;font-size:32px;font-weight:700;color:#111827;font-family:monospace;">
            ${otp}
          </div>
          <p style="font-size:12px;color:#9ca3af;margin:20px 0 0;">If you didn't request this, contact your account manager immediately.</p>
        </div>`,
    })
  } catch (e) {
    console.error('[client-resend] email failed:', e)
    return NextResponse.json({ error: 'Failed to send code — try again later' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
