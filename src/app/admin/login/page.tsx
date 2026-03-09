'use client'

// Admin Login — /admin/login
// Clean light-theme login screen.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminLoginPage() {
  const router   = useRouter()
  const [password, setPassword] = useState('')
  const [error,   setError]     = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/auth/admin-login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ password }),
    })
    if (res.ok) {
      router.push('/admin')
    } else {
      setError('Incorrect password')
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--bg-base)' }}
    >
      <div className="card p-8 w-full max-w-sm" style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        {/* Logo placeholder */}
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
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoFocus
              className="input"
              placeholder="Enter your password"
            />
          </div>

          {error && (
            <p className="text-sm" style={{ color: 'var(--red)' }}>{error}</p>
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
      </div>
    </div>
  )
}
