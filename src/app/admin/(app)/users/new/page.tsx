'use client'

// New User — /admin/users/new
// Super admin only. Creates a new admin account with email + password.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function NewUserPage() {
  const router = useRouter()
  const [form, setForm] = useState({
    name:     '',
    email:    '',
    password: '',
    role:     'admin' as 'admin' | 'viewer',
  })
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setLoading(true)
    setError('')
    const res = await fetch('/api/admin/users', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(form),
    })
    const data = await res.json()
    if (data.error) {
      setError(data.error)
      setLoading(false)
    } else {
      router.push('/admin/users')
    }
  }

  return (
    <div className="max-w-md">
      <div className="flex items-center gap-2 mb-6 text-sm">
        <Link href="/admin/users" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
          Users
        </Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>New User</span>
      </div>

      <div className="card p-6">
        <h1 className="text-base font-semibold mb-5" style={{ color: 'var(--text-primary)' }}>
          Create Admin Account
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              Full Name
            </label>
            <input
              className="input"
              required
              placeholder="Jane Smith"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>

          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              Email Address
            </label>
            <input
              className="input"
              type="email"
              required
              placeholder="jane@agency.com"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            />
          </div>

          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              Password
              <span className="ml-1 font-normal" style={{ color: 'var(--text-faint)' }}>
                — min. 8 characters
              </span>
            </label>
            <input
              className="input"
              type="password"
              required
              minLength={8}
              placeholder="Set initial password"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            />
          </div>

          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              Role
            </label>
            <select
              className="input"
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value as 'admin' | 'viewer' }))}
            >
              <option value="admin">Admin — full access (except user management)</option>
              <option value="viewer">Viewer — read-only access</option>
            </select>
          </div>

          {error && (
            <p className="text-sm" style={{ color: 'var(--red)' }}>{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <Link href="/admin/users" className="btn btn-secondary flex-1 justify-center">
              Cancel
            </Link>
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary flex-1 justify-center"
            >
              {loading ? 'Creating…' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
