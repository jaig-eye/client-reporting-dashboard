'use client'

// Admin Login — /admin
// Super admin: leave email blank, enter master password.
// Regular admin: enter email/username + password.

import { Suspense, useState, useEffect, lazy } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

const LoginCanvas = lazy(() => import('@/components/admin/LoginCanvas'))

function AdminLoginForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const returnUrl    = searchParams.get('returnUrl') ?? '/admin/dashboard'
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [code,     setCode]     = useState('')
  const [step,     setStep]     = useState<'password' | 'code'>('password')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [branding, setBranding] = useState<{ agency_name: string; agency_logo_url: string | null }>({
    agency_name: 'LaunchLocal', agency_logo_url: null,
  })

  useEffect(() => {
    fetch('/api/settings/branding')
      .then(r => r.json())
      .then(d => setBranding(d))
      .catch(() => {})
  }, [])

  const isSuperAdmin = email.trim() === ''

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const body: Record<string, string> = { password }
    if (email.trim()) body.email = email.trim()
    if (step === 'code') body.code = code

    const res = await fetch('/api/auth/admin-login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))

    if (res.ok && data.step === 'code') {
      setStep('code')
      setLoading(false)
      return
    }
    if (res.ok) {
      router.push(returnUrl)
      return
    }
    setError(data.error || 'Invalid credentials')
    setLoading(false)
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--bg-base)', position: 'relative' }}
    >
      <Suspense fallback={null}><LoginCanvas /></Suspense>

      <div className="card p-8 w-full max-w-sm" style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.08)', position: 'relative', zIndex: 1 }}>
        <div className="mb-6">
          <div className="mb-3">
            {branding.agency_logo_url ? (
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
            {branding.agency_name}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Sign in to access the agency dashboard.
          </p>
        </div>

        {step === 'code' ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
                Login code
              </label>
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
                Check support@golaunchlocal.com — code expires in 10 minutes.
              </p>
            </div>

            {error && (
              <div
                className="rounded-lg px-3 py-2 text-sm"
                style={{ background: 'var(--red-subtle)', color: 'var(--red)', border: '1px solid #fecaca' }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="btn btn-primary w-full justify-center"
              style={{ padding: '0.625rem' }}
            >
              {loading ? 'Verifying…' : 'Verify code'}
            </button>

            <button
              type="button"
              onClick={() => { setStep('password'); setCode(''); setError('') }}
              className="btn btn-secondary w-full justify-center"
              style={{ padding: '0.625rem' }}
            >
              ← Back
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
                Email or username
              </label>
              <input
                type="text"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="username"
                className="input"
                placeholder="admin@agency.com or username"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                  Password
                </label>
                {!isSuperAdmin && (
                  <a href="/admin/forgot-password" className="text-xs" style={{ color: 'var(--blue)', textDecoration: 'none' }}>
                    Forgot password?
                  </a>
                )}
              </div>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="input"
                placeholder={isSuperAdmin ? 'Master password' : 'Your password'}
              />
            </div>

            {error && (
              <div
                className="rounded-lg px-3 py-2 text-sm"
                style={{ background: 'var(--red-subtle)', color: 'var(--red)', border: '1px solid #fecaca' }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full justify-center"
              style={{ padding: '0.625rem' }}
            >
              {loading ? (isSuperAdmin ? 'Sending code…' : 'Signing in…') : 'Sign in'}
            </button>
          </form>
        )}

        <p className="text-xs mt-5 text-center" style={{ color: 'var(--text-faint)' }}>
          {step === 'code'
            ? 'Super admin — two-step verification'
            : isSuperAdmin
              ? 'Super admin mode — full access'
              : 'Enter your agency email and password'}
        </p>
      </div>
    </div>
  )
}

export default function AdminLoginPage() {
  return (
    <Suspense>
      <AdminLoginForm />
    </Suspense>
  )
}
