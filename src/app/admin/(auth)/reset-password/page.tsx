'use client'

import { Suspense, useState, useEffect, lazy } from 'react'
import { useSearchParams } from 'next/navigation'

const LoginCanvas = lazy(() => import('@/components/admin/LoginCanvas'))

function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const token        = searchParams.get('token') ?? ''

  const [password,  setPassword]  = useState('')
  const [confirm,   setConfirm]   = useState('')
  const [loading,   setLoading]   = useState(false)
  const [success,   setSuccess]   = useState(false)
  const [error,     setError]     = useState('')
  const [branding,  setBranding]  = useState<{ agency_name: string }>({ agency_name: 'Agency Dashboard' })

  useEffect(() => {
    fetch('/api/settings/branding')
      .then(r => r.json())
      .then(d => setBranding(d))
      .catch(() => {})
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    const res = await fetch('/api/auth/reset-password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token, password }),
    })
    setLoading(false)

    if (res.ok) {
      setSuccess(true)
    } else {
      const d = await res.json().catch(() => ({})) as { error?: string }
      setError(d.error || 'Reset failed — the link may have expired')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)', position: 'relative' }}>
      <Suspense fallback={null}><LoginCanvas /></Suspense>

      <div className="card p-8 w-full max-w-sm" style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.08)', position: 'relative', zIndex: 1 }}>
        <div className="mb-6">
          <div className="h-9 w-9 rounded-xl flex items-center justify-center text-white font-bold text-lg mb-3" style={{ background: 'var(--blue)' }}>
            {branding.agency_name.charAt(0).toUpperCase()}
          </div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>New password</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {success ? 'Password updated — sign in with your new password.' : 'Choose a new password (min 8 characters).'}
          </p>
        </div>

        {!token && (
          <p className="text-sm" style={{ color: 'var(--red)' }}>Invalid reset link — no token found.</p>
        )}

        {token && !success && (
          <form onSubmit={handleSubmit} className="space-y-4">
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

        <div className="text-center mt-4">
          <a href="/admin" className="text-xs" style={{ color: 'var(--blue)', textDecoration: 'none' }}>
            {success ? 'Sign in →' : '← Back to sign in'}
          </a>
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
