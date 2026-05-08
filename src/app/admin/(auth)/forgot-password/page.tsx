'use client'

import { Suspense, useState, useEffect, lazy } from 'react'

const LoginCanvas = lazy(() => import('@/components/admin/LoginCanvas'))

function ForgotPasswordForm() {
  const [email,     setEmail]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [branding,  setBranding]  = useState<{ agency_name: string }>({ agency_name: 'Agency Dashboard' })

  useEffect(() => {
    fetch('/api/settings/branding')
      .then(r => r.json())
      .then(d => setBranding(d))
      .catch(() => {})
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    await fetch('/api/auth/forgot-password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email: email.trim() }),
    }).catch(() => {})
    setLoading(false)
    setSubmitted(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)', position: 'relative' }}>
      <Suspense fallback={null}><LoginCanvas /></Suspense>

      <div className="card p-8 w-full max-w-sm" style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.08)', position: 'relative', zIndex: 1 }}>
        <div className="mb-6">
          <div className="h-9 w-9 rounded-xl flex items-center justify-center text-white font-bold text-lg mb-3" style={{ background: 'var(--blue)' }}>
            {branding.agency_name.charAt(0).toUpperCase()}
          </div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Reset password</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {submitted
              ? "If that email has an account, a reset link is on its way."
              : "Enter your email and we'll send a reset link."}
          </p>
        </div>

        {!submitted ? (
          <form onSubmit={handleSubmit} className="space-y-4">
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
            <button type="submit" disabled={loading} className="btn btn-primary w-full justify-center" style={{ padding: '0.625rem' }}>
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        ) : (
          <p className="text-sm text-center" style={{ color: 'var(--green)' }}>
            Check your inbox for a reset link.
          </p>
        )}

        <div className="text-center mt-4">
          <a href="/admin" className="text-xs" style={{ color: 'var(--blue)', textDecoration: 'none' }}>
            ← Back to sign in
          </a>
        </div>
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
