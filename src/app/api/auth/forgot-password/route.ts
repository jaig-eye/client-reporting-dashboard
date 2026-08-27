// POST /api/auth/forgot-password
// Step 1 of code-based password reset.
// Always returns 200 — never reveals whether the email exists.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { issueResetCode } from '@/lib/passwordReset'


// In-memory rate limit: 3 attempts per IP per 15 minutes
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_MAX = 3
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

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again in 15 minutes.' },
      { status: 429 }
    )
  }

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

  // Result deliberately DISCARDED: the response must look identical whether or
  // not the address exists, so a failure is logged inside the helper and never
  // surfaced here. (The forced-rotation path in admin-login does check it, since
  // there a silent failure would be a lockout.)
  await issueResetCode(db, { id: user.id, email: user.email }, { reason: 'self_service' })

  return NextResponse.json({ ok: true })
}
