'use client'

// Admin Login — /admin
// Super admin: leave email blank, enter master password.
// Regular admin: enter email + password set by super admin.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminLoginPage() {
  const router    = useRouter()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const isSuperAdmin = email.trim() === ''

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/auth/admin-login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email: email.trim() || undefined, password }),
    })
    if (res.ok) {
      router.push('/admin/dashboard')
    } else {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Invalid credentials')
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--bg-base)' }}
    >
      <div className="card p-8 w-full max-w-sm" style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <div className="mb-6">
          <div
            className="h-9 w-9 rounded-xl flex items-center justify-center text-white font-bold text-lg mb-3"
            style={{ background: 'var(--blue)' }}
          >
            A
          </div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Admin Login
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Sign in to access the agency dashboard.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              Email
              <span className="ml-1 font-normal" style={{ color: 'var(--text-faint)' }}>
                — leave blank to sign in as super admin
              </span>
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              className="input"
              placeholder="admin@agency.com"
            />
          </div>

          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              Password
            </label>
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
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-xs mt-5 text-center" style={{ color: 'var(--text-faint)' }}>
          {isSuperAdmin
            ? 'Super admin mode — full access'
            : 'Enter your agency email and password'}
        </p>
      </div>
    </div>
  )
}
