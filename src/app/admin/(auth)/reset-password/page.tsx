'use client'

// Set a new password using the six-digit code emailed by /api/auth/forgot-password
// or by the forced rotation on sign-in.
//
// This page used to read a `token` query param and POST { token, password }. The
// API has never accepted that shape — it wants { email, code, password } — so
// every submission 400'd and the page was unreachable anyway (nothing links to it
// with a token). It matters now because the forced rotation sends people here.
//
// `email` is prefilled from the query string when we know it (the login page
// passes it through) so the common path is: read code from email, type it, choose
// a password.

import { Suspense, useState, useEffect, lazy } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

const LoginCanvas = lazy(() => import('@/components/admin/LoginCanvas'))

function ResetPasswordForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const [email,    setEmail]    = useState(searchParams.get('email') ?? '')
  const [code,     setCode]     = useState('')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [loading,  setLoading]  = useState(false)
  const [success,  setSuccess]  = useState(false)
  const [error,    setError]    = useState('')
  // agency_logo_url as well as the name. Fetching only the name meant this page always
  // drew the initial-letter placeholder even when a real logo was configured — the
  // sign-in page has rendered the logo all along, so the reset flow looked like a
  // different, unbranded product at exactly the moment trust matters most.
  const [branding, setBranding] = useState<{ agency_name: string; agency_logo_url: string | null }>({
    agency_name: 'Agency Dashboard', agency_logo_url: null,
  })

  // Set when the user arrived here because sign-in required a rotation, so the
  // copy can explain why they are here rather than implying they asked for it.
  const forced = searchParams.get('forced') === '1'

  useEffect(() => {
    fetch('/api/settings/branding')
      .then(r => r.json())
      .then(d => setBranding(d))
      .catch(() => {})
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!email.trim())          { setError('Enter the email address the code was sent to'); return }
    if (!code.trim())           { setError('Enter the 6-digit code from your email');       return }
    if (password.length < 8)    { setError('Password must be at least 8 characters');       return }
    if (password !== confirm)   { setError('Passwords do not match');                       return }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), code: code.trim(), password }),
      })
      if (res.ok) {
        setSuccess(true)
        // Straight back to sign-in — they now have a working password.
        setTimeout(() => router.push('/admin'), 1500)
        return
      }
      const d = await res.json().catch(() => ({})) as { error?: string }
      setError(d.error || 'Reset failed — the code may have expired')
    } catch {
      setError('Network error — please try again.')
    } finally {
      setLoading(false)
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
              <div
                className="h-9 w-9 rounded-xl flex items-center justify-center text-white font-bold text-lg"
                style={{ background: 'var(--blue)' }}
              >
                {branding.agency_name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {forced ? 'Update your password' : 'New password'}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {success
              ? 'Password updated — signing you in…'
              : forced
                ? 'Your password needs updating for security. Enter the code we emailed you and choose a new one.'
                : 'Enter the code from your email and choose a new password.'}
          </p>
        </div>

        {!success && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="username"
                className="input"
                placeholder="you@agency.com"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>6-digit code</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                className="input"
                placeholder="123456"
                style={{ letterSpacing: '0.3em', fontFamily: 'monospace' }}
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>New password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="input"
                placeholder="Min 8 characters"
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

            <button type="submit" disabled={loading} className="btn btn-primary w-full justify-center" style={{ padding: '0.625rem' }}>
              {loading ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}

        <div className="text-center mt-4 space-y-1">
          <div>
            <a href="/admin/forgot-password" className="text-xs" style={{ color: 'var(--blue)', textDecoration: 'none' }}>
              Need a new code?
            </a>
          </div>
          <div>
            <a href="/admin" className="text-xs" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
              ← Back to sign in
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  )
}
