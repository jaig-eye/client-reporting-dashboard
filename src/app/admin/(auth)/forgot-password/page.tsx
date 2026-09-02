'use client'

import { Suspense, useState, useEffect, lazy } from 'react'

const LoginCanvas = lazy(() => import('@/components/admin/LoginCanvas'))

function ForgotPasswordForm() {
  const [step,     setStep]     = useState<'email' | 'code'>('email')
  const [email,    setEmail]    = useState('')
  const [code,     setCode]     = useState('')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [loading,  setLoading]  = useState(false)
  const [done,     setDone]     = useState(false)
  const [error,    setError]    = useState('')
  // agency_logo_url as well as the name — fetching only the name meant this page always
  // drew the initial-letter placeholder even with a real logo configured.
  const [branding, setBranding] = useState<{ agency_name: string; agency_logo_url: string | null }>({
    agency_name: 'Agency Dashboard', agency_logo_url: null,
  })

  useEffect(() => {
    fetch('/api/settings/branding')
      .then(r => r.json())
      .then(d => setBranding(d))
      .catch(() => {})
  }, [])

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    // Advance ONLY on a real 200. This used to discard the response entirely and
    // setStep('code') unconditionally, so a 429 from the rate limiter, a 500, or a
    // dropped connection all rendered as 'Enter the code we sent to your email' and
    // 'expires in 10 minutes' for a code that was never sent — on the one page a
    // locked-out admin depends on.
    try {
      const res  = await fetch('/api/auth/forgot-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Could not send a reset code. Please try again in a few minutes.')
        return
      }
      setStep('code')
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setLoading(true)
    setError('')
    let res: Response
    let data: { error?: string }
    try {
      res  = await fetch('/api/auth/reset-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), code, password }),
      })
      data = await res.json().catch(() => ({}))
    } catch {
      setLoading(false)
      setError('Could not reach the server. Check your connection and try again.')
      return
    }
    setLoading(false)
    if (res.ok) {
      setDone(true)
    } else {
      setError(data.error || 'Something went wrong')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)', position: 'relative' }}>
      <Suspense fallback={null}><LoginCanvas /></Suspense>

      <div className="card p-8 w-full max-w-sm" style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.08)', position: 'relative', zIndex: 1 }}>
        <div className="mb-6">
          <div className="mb-3">
            {branding.agency_logo_url ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={branding.agency_logo_url}
                alt={branding.agency_name}
                style={{ height: '2.25rem', maxWidth: '10rem', objectFit: 'contain' }}
              />
            ) : (
              /* Reserve the same box so the header does not jump when the logo lands.
                 Deliberately empty: the initial-letter fallback that used to sit here
                 rendered on every first paint, before branding had loaded. */
              <div className="h-9 w-9" aria-hidden="true" />
            )}
          </div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Reset password</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {done
              ? 'Password updated — you can sign in now.'
              : step === 'code'
                ? 'Enter the code we sent to your email.'
                : "Enter your email and we'll send a reset code."}
          </p>
        </div>

        {done ? (
          <a href="/admin" className="btn btn-primary w-full justify-center" style={{ padding: '0.625rem' }}>
            Sign in
          </a>
        ) : step === 'code' ? (
          <form onSubmit={handleReset} className="space-y-4">
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Reset code</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                required
                autoFocus
                autoComplete="one-time-code"
                className="input"
                style={{ letterSpacing: '0.2em', fontSize: '1.25rem', textAlign: 'center' }}
                placeholder="000000"
              />
              <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                Sent to {email} — expires in 10 minutes.
              </p>
            </div>

            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>New password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="input"
                placeholder="Min. 8 characters"
              />
            </div>

            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Confirm password</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                className="input"
                placeholder="Repeat password"
              />
            </div>

            {error && (
              <div className="rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--red-subtle)', color: 'var(--red)', border: '1px solid #fecaca' }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading || code.length !== 6} className="btn btn-primary w-full justify-center" style={{ padding: '0.625rem' }}>
              {loading ? 'Resetting…' : 'Reset password'}
            </button>

            <button type="button" onClick={() => { setStep('email'); setCode(''); setError('') }} className="btn btn-secondary w-full justify-center" style={{ padding: '0.625rem' }}>
              ← Back
            </button>
          </form>
        ) : (
          <form onSubmit={handleSendCode} className="space-y-4">
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="input"
                placeholder="admin@agency.com"
              />
            </div>

            {error && (
              <div className="rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--red-subtle)', color: 'var(--red)', border: '1px solid #fecaca' }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn btn-primary w-full justify-center" style={{ padding: '0.625rem' }}>
              {loading ? 'Sending…' : 'Send code'}
            </button>
          </form>
        )}

        {!done && (
          <div className="text-center mt-4">
            <a href="/admin" className="text-xs" style={{ color: 'var(--blue)', textDecoration: 'none' }}>
              ← Back to sign in
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  )
}
