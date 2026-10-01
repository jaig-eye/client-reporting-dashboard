'use client'

// Runs a Google or Meta sign-in in a popup and refreshes the page in place when it finishes — no
// reload, and it works inside the CRM's iframe, where Google won't show its sign-in. If the
// browser blocks the popup, it falls back to the old full-page redirect.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export type OAuthStatus = 'idle' | 'waiting' | 'connected' | 'failed'

interface OAuthMessage { source: 'agency-oauth'; provider: string; ok: boolean; error: string | null }

export function useOAuthPopup(opts: { onDone?: (ok: boolean, error: string | null) => void } = {}) {
  const router = useRouter()
  const [status, setStatus] = useState<OAuthStatus>('idle')
  const [error, setError]   = useState<string | null>(null)
  const popupRef = useRef<Window | null>(null)
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const doneRef  = useRef(opts.onDone)
  doneRef.current = opts.onDone

  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return
      const d = e.data as OAuthMessage | null
      if (!d || d.source !== 'agency-oauth') return
      stopPolling()
      popupRef.current = null
      setStatus(d.ok ? 'connected' : 'failed')
      setError(d.ok ? null : (d.error ?? 'Sign-in failed.'))
      if (d.ok) router.refresh()
      doneRef.current?.(d.ok, d.error)
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage); stopPolling() }
  }, [router])

  const start = useCallback((startUrl: string) => {
    const url = startUrl + (startUrl.includes('?') ? '&' : '?') + 'popup=1'
    const w = 520, h = 680
    const left = Math.max(0, window.screenX + (window.outerWidth - w) / 2)
    const top  = Math.max(0, window.screenY + (window.outerHeight - h) / 2)
    const popup = window.open(url, 'agency-oauth', `popup=yes,width=${w},height=${h},left=${left},top=${top}`)
    if (!popup) {
      // Popup blocked: the full-page flow, which redirects back to Integrations.
      window.location.href = startUrl
      return
    }
    popupRef.current = popup
    setStatus('waiting')
    setError(null)
    // Closed without finishing (the person changed their mind): stop waiting.
    stopPolling()
    pollRef.current = setInterval(() => {
      if (popupRef.current?.closed) {
        stopPolling()
        popupRef.current = null
        setStatus(s => (s === 'waiting' ? 'idle' : s))
      }
    }, 600)
  }, [])

  const reset = useCallback(() => { setStatus('idle'); setError(null) }, [])

  return { start, status, error, reset }
}
