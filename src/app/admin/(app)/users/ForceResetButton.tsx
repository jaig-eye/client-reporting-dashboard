'use client'

// Super-admin control for POST /api/admin/users/[id]/force-reset.
//
// Without this the endpoint was unreachable from the app: a colleague flagged for
// rotation who simply did not log in stayed flagged forever, and the only way to
// nudge them was a hand-crafted curl with a valid super-admin cookie.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ForceResetButton({
  userId,
  userName,
  alreadyPending,
}: {
  userId:         string
  userName:       string
  /** True when must_reset_password is already set — the label becomes "Resend". */
  alreadyPending: boolean
}) {
  const router = useRouter()
  const [busy,   setBusy]   = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  async function run() {
    const verb = alreadyPending ? 'Send a new reset code to' : 'Require a password reset for'
    if (!confirm(`${verb} ${userName}?\n\nThey will not be able to sign in until they set a new password.`)) return

    setBusy(true)
    setResult(null)
    try {
      const res = await fetch(`/api/admin/users/${userId}/force-reset`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sendEmail: true }),
      })
      const d = await res.json().catch(() => ({})) as { ok?: boolean; message?: string; error?: string }

      // A partial success is real here: the flag can land while the email fails.
      // Reporting that as a flat failure would hide that the person is now blocked.
      setResult({ ok: res.ok && d.ok === true, text: d.message || d.error || (res.ok ? 'Done.' : 'Failed.') })
      router.refresh()
    } catch {
      setResult({ ok: false, text: 'Network error — please try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        onClick={run}
        disabled={busy}
        className="btn btn-secondary"
        style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
        title="Require this user to set a new password, and email them a code now"
      >
        {busy ? 'Sending…' : alreadyPending ? 'Resend code' : 'Reset password'}
      </button>
      {result && (
        <span
          className="text-xs"
          style={{ color: result.ok ? 'var(--green)' : 'var(--red)', maxWidth: 260, textAlign: 'right', lineHeight: 1.4 }}
        >
          {result.text}
        </span>
      )}
    </span>
  )
}
