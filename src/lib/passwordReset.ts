// ─────────────────────────────────────────────────────────────────────────────
// Password-reset codes.
//
// Two callers issue them and they must behave identically: the self-service
// "forgot password" form, and the forced rotation that fires when a user with
// must_reset_password logs in. Duplicating the token/email logic across both is
// how they drift — one gets a shorter expiry, or forgets to invalidate the
// previous code, and only one of the two paths is ever tested.
//
// The sender address comes from MAILGUN_FROM in the environment, NOT from
// agency_settings — that table has only `notification_email`, which is a
// recipient. agency_settings.agency_name is used for the subject line so the
// email is recognisable.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail, isEmailConfigured } from '@/lib/email'
import { createHash, randomInt } from 'crypto'

export const RESET_CODE_TTL_MS = 10 * 60 * 1000

/** SHA-256 is fine here, unlike for passwords: the input is a random 6-digit
 *  code with a 10-minute life, not a human-chosen secret worth cracking. */
export function hashResetCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

function generateCode(): string {
  return String(randomInt(100000, 999999))
}

export type IssueResult =
  | { ok: true }
  | { ok: false; reason: 'email_not_configured' | 'send_failed' | 'db_error'; detail?: string }

/**
 * Invalidate any outstanding codes, mint a new one, and email it.
 *
 * Returns a real result rather than swallowing failures. The self-service route
 * deliberately discards it (so the response cannot be used to discover which
 * addresses exist), but the forced-rotation path needs to know: telling someone
 * "check your email" and then blocking their login is a lockout if the mail
 * never left.
 */
export async function issueResetCode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  user: { id: string; email: string },
  opts?: { reason?: 'forced' | 'self_service' },
): Promise<IssueResult> {
  if (!isEmailConfigured()) {
    console.error('[passwordReset] MAILGUN_SMTP_* not configured — cannot send a reset code')
    return { ok: false, reason: 'email_not_configured' }
  }

  // One live code at a time, so an older email cannot still be redeemed.
  const { error: invalidateErr } = await db
    .from('password_reset_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('used_at', null)
  if (invalidateErr) {
    console.error('[passwordReset] could not invalidate prior codes:', invalidateErr.message)
    return { ok: false, reason: 'db_error', detail: invalidateErr.message }
  }

  const code = generateCode()
  const { error: insertErr } = await db.from('password_reset_tokens').insert({
    user_id:    user.id,
    token_hash: hashResetCode(code),
    expires_at: new Date(Date.now() + RESET_CODE_TTL_MS).toISOString(),
  })
  if (insertErr) {
    console.error('[passwordReset] could not store the code:', insertErr.message)
    return { ok: false, reason: 'db_error', detail: insertErr.message }
  }

  const { data: settings } = await db
    .from('agency_settings')
    .select('agency_name')
    .maybeSingle()
  const agencyName = (settings as { agency_name?: string } | null)?.agency_name ?? 'Agency Dashboard'

  const forced = opts?.reason === 'forced'
  const lead = forced
    ? 'Your account needs a new password before you can sign in again. Enter this code on the reset page to set one.'
    : 'Enter this code on the reset page.'

  try {
    await sendEmail({
      to:      user.email,
      subject: `${agencyName} — Your password reset code`,
      text:    `${lead}\n\nCode: ${code}\n\nIt expires in 10 minutes.\n\nIf you didn't request this, ignore this email — your password hasn't changed.`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:400px;margin:0 auto;padding:32px 24px;">
          <h2 style="font-size:18px;font-weight:700;color:#111827;margin:0 0 8px;">
            ${forced ? 'Set a new password' : 'Password reset code'}
          </h2>
          <p style="font-size:14px;color:#6b7280;margin:0 0 24px;">${lead} It expires in 10 minutes.</p>
          <div style="background:#f3f4f6;border-radius:8px;padding:20px;text-align:center;letter-spacing:0.2em;font-size:32px;font-weight:700;color:#111827;font-family:monospace;">
            ${code}
          </div>
          <p style="font-size:12px;color:#9ca3af;margin:20px 0 0;">
            ${forced
              ? 'This is a one-off security rotation requested by your administrator.'
              : "If you didn't request this, ignore this email — your password hasn't changed."}
          </p>
        </div>`,
    })
    return { ok: true }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    console.error('[passwordReset] email send failed:', detail)
    return { ok: false, reason: 'send_failed', detail }
  }
}
