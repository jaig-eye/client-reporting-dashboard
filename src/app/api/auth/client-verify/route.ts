// POST /api/auth/client-verify
// Body: { code: string }
// Validates a client's IP-change OTP. On success, updates last_known_ip and
// clears the OTP fields so subsequent page loads pass the IP check normally.

import { NextRequest, NextResponse } from 'next/server'
import { cookies, headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import crypto from 'crypto'

function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex')
}

export async function POST(request: NextRequest) {
  const cookieStore  = await cookies()
  const headerStore  = await headers()
  const clientToken  = cookieStore.get('client_token')?.value

  if (!clientToken) {
    return NextResponse.json({ error: 'Session expired' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({})) as { code?: string }
  const code = String(body.code ?? '').trim()
  if (!code || code.length !== 6) {
    return NextResponse.json({ error: 'Invalid code format' }, { status: 400 })
  }

  const db = createAdminClient()

  const { data: client } = await db
    .from('clients')
    .select('id, client_otp_hash, client_otp_expires_at')
    .eq('dashboard_token', clientToken)
    .maybeSingle()

  if (!client) {
    return NextResponse.json({ error: 'Session invalid' }, { status: 401 })
  }

  const row = client as unknown as {
    id: string
    client_otp_hash: string | null
    client_otp_expires_at: string | null
  }

  if (
    !row.client_otp_hash ||
    !row.client_otp_expires_at ||
    new Date(row.client_otp_expires_at) < new Date() ||
    hashOtp(code) !== row.client_otp_hash
  ) {
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 })
  }

  // Success — update IP and clear OTP
  const currentIp = headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  await db.from('clients').update({
    last_known_ip:         currentIp,
    client_otp_hash:       null,
    client_otp_expires_at: null,
  }).eq('id', row.id)

  return NextResponse.json({ ok: true })
}
