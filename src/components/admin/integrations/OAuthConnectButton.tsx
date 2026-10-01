'use client'

// "Connect with Google" / "Reconnect Meta": opens the sign-in in a popup, shows that it's waiting,
// and when it finishes the page around it refreshes to show the new status.

import { CheckCircle, ArrowClockwise } from '@phosphor-icons/react'
import { useEffect } from 'react'
import { useOAuthPopup } from './useOAuthPopup'

export default function OAuthConnectButton({ href, label, variant = 'primary', size, provider }: {
  /** The flow's start URL, e.g. /api/auth/google/start. */
  href: string
  label: string
  variant?: 'primary' | 'secondary'
  size?: 'sm'
  /** For the messages: "Google", "Meta". */
  provider: string
}) {
  const { start, status, error, reset } = useOAuthPopup()

  // The success state shows briefly, then the button returns to normal on the refreshed page.
  useEffect(() => {
    if (status !== 'connected') return
    const t = setTimeout(reset, 2400)
    return () => clearTimeout(t)
  }, [status, reset])

  const cls = `btn ${variant === 'primary' ? 'btn-primary' : 'btn-secondary'}${size === 'sm' ? ' btn-sm' : ''}`
  return (
    <span className="int-oauth">
      <button type="button" className={cls} onClick={() => start(href)} disabled={status === 'waiting'} aria-live="polite">
        {status === 'waiting'   ? <><ArrowClockwise size={14} className="int-spin" aria-hidden />Waiting for {provider}…</>
         : status === 'connected' ? <><CheckCircle size={15} weight="fill" aria-hidden />Connected</>
         : label}
      </button>
      {status === 'failed' && error && <span className="int-oauth-error" role="alert">{error}</span>}
    </span>
  )
}
