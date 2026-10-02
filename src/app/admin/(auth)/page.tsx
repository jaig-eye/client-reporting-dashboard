'use client'

// Admin Login — /admin
// Super admin: leave email blank, enter master password.
// Regular admin: enter email/username + password.
//
// While a sign-in is in flight the form is locked: the fields and the button are disabled, the
// button shows a spinner and what's happening, a progress bar runs along the top of the card, and
// the mesh behind swirls around it (LoginCanvas). The busy state lasts at least MIN_BUSY_MS, so a
// quick answer still reads as "checked" rather than a flicker. A successful sign-in stays locked
// until the dashboard has loaded; it used to unlock in a finally block while the page was still
// navigating, so the button could be pressed again.

import { Suspense, useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, WarningCircle } from '@phosphor-icons/react'
import LoginCanvas from '@/components/admin/LoginCanvas'
import AuthBrand from '@/components/admin/AuthBrand'

type Phase = 'idle' | 'busy' | 'success' | 'error'

const MIN_BUSY_MS = 700

function AdminLoginForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  // Same-origin paths only. This lands in router.push() straight after a successful
  // sign-in, so an unvalidated value made the real login page a redirector: a
  // /admin?returnUrl=https://evil.example link authenticates the admin for real, then
  // hands them to the attacker's page — and middleware itself mints ?returnUrl= links,
  // so the shape looks routine. '//host' and '/\host' are protocol-relative and
  // must be rejected along with absolute URLs.
  const rawReturn    = searchParams.get('returnUrl')
  const returnUrl    =
    rawReturn && rawReturn.startsWith('/')
    && !rawReturn.startsWith('//') && !rawReturn.startsWith('/\\')
      ? rawReturn
      : '/admin/dashboard'
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [code,     setCode]     = useState('')
  const [step,     setStep]     = useState<'password' | 'code'>('password')
  const [error,    setError]    = useState('')
  const [phase,    setPhase]    = useState<Phase>('idle')
  // A second Enter can land before React re-renders the disabled button; this can't.
  const inFlight = useRef(false)

  const locked = phase === 'busy' || phase === 'success'

  /** Typing after an error clears it, and the background calms back down. */
  function edited() {
    if (phase === 'error') { setPhase('idle'); setError('') }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setPhase('busy')
    setError('')
    const body: Record<string, string> = { password }
    if (email.trim()) body.email = email.trim()
    if (step === 'code') body.code = code

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    let leaving = false
    const startedAt = Date.now()
    const settle = () => new Promise(r => setTimeout(r, Math.max(0, MIN_BUSY_MS - (Date.now() - startedAt))))

    try {
      const res = await fetch('/api/auth/admin-login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  controller.signal,
      })
      const data = await res.json().catch(() => ({}))

      if (res.ok && data.step === 'code') {
        await settle()
        setStep('code')
        setPhase('idle')
        return
      }
      if (res.ok) {
        // Stay locked until the dashboard replaces this page.
        leaving = true
        setPhase('success')
        router.push(returnUrl)
        return
      }

      // A forced password rotation is NOT a credential failure. The password was
      // correct; the account simply cannot hold a session until it is rotated.
      // Without this branch the 403 fell through to the generic message below and
      // told every admin their correct password was wrong, while a reset code
      // arrived silently in their inbox with nothing pointing at it.
      if (data.resetRequired) {
        if (data.emailSent) {
          const q = new URLSearchParams({ forced: '1' })
          if (typeof data.email === 'string') q.set('email', data.email)
          leaving = true
          router.push(`/admin/reset-password?${q.toString()}`)
          return
        }
        // Flagged, but no code could be sent — the message explains why.
        setError(data.error || 'Your password must be reset, but a code could not be emailed. Contact your administrator.')
        setPhase('error')
        return
      }

      await settle()
      setError(data.error || 'That email and password don’t match. Try again.')
      setPhase('error')
    } catch (err) {
      await settle()
      setError(err instanceof DOMException && err.name === 'AbortError'
        ? 'The sign-in took too long. Check your connection and try again.'
        : 'Couldn’t reach the server. Check your connection and try again.')
      setPhase('error')
    } finally {
      clearTimeout(timeout)
      if (!leaving) inFlight.current = false
    }
  }

  const busyLabel = step === 'code' ? 'Verifying' : 'Signing in'
  const doneLabel = 'Opening the dashboard'

  return (
    <main className="au">
      <LoginCanvas mode={phase} />

      <section className="au-card" aria-labelledby="au-title" aria-busy={locked || undefined} data-phase={phase}>
        <div className="au-progress" aria-hidden />

        <AuthBrand />

        <h1 className="au-title" id="au-title">{step === 'code' ? 'Check your email' : 'Sign in'}</h1>
        <p className="au-sub">
          {step === 'code'
            ? 'We emailed you a 6-digit code. It expires in 10 minutes.'
            : 'Every client’s reporting, content and spend, in one place.'}
        </p>

        {/* Announced to screen readers as it changes. */}
        <p className="sr-only" role="status" aria-live="polite">
          {phase === 'busy' ? busyLabel : phase === 'success' ? doneLabel : ''}
        </p>

        <form onSubmit={handleSubmit} className="au-form">
          <fieldset className="au-fieldset" disabled={locked}>
            {step === 'code' ? (
              <div>
                <label className="au-label" htmlFor="au-code" style={{ marginBottom: 6 }}>Login code</label>
                <input
                  id="au-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={e => { setCode(e.target.value.replace(/\D/g, '')); edited() }}
                  required
                  autoFocus
                  autoComplete="one-time-code"
                  className="au-input au-input--code"
                  placeholder="000000"
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="au-label" htmlFor="au-email" style={{ marginBottom: 6 }}>Email or username</label>
                  <input
                    id="au-email"
                    type="text"
                    value={email}
                    onChange={e => { setEmail(e.target.value); edited() }}
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    className="au-input"
                    placeholder="you@agency.com"
                  />
                </div>
                <div>
                  <div className="au-label-row">
                    <label className="au-label" htmlFor="au-password">Password</label>
                    <Link href="/admin/forgot-password" className="au-link">Forgot password?</Link>
                  </div>
                  <input
                    id="au-password"
                    type="password"
                    value={password}
                    onChange={e => { setPassword(e.target.value); edited() }}
                    required
                    autoComplete="current-password"
                    className="au-input"
                    placeholder="Your password"
                  />
                </div>
              </>
            )}
          </fieldset>

          {error && (
            <p className="au-error" role="alert">
              <WarningCircle size={16} weight="fill" aria-hidden />{error}
            </p>
          )}

          <button
            type="submit"
            className="au-btn"
            disabled={locked || (step === 'code' && code.length !== 6)}
            aria-busy={locked || undefined}
          >
            {locked ? (
              <><span className="au-spin" aria-hidden />{phase === 'success' ? doneLabel : busyLabel}</>
            ) : step === 'code' ? 'Verify code' : 'Sign in'}
          </button>

          {step === 'code' && (
            <button
              type="button"
              className="au-btn au-btn--ghost"
              disabled={locked}
              onClick={() => { setStep('password'); setCode(''); setError(''); setPhase('idle') }}
            >
              <ArrowLeft size={16} weight="bold" aria-hidden />Back
            </button>
          )}
        </form>
      </section>
    </main>
  )
}

export default function AdminLoginPage() {
  return (
    <Suspense>
      <AdminLoginForm />
    </Suspense>
  )
}
