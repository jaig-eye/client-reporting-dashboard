'use client'

// Edit User Form — used by super admin on /admin/users/[id]
// Can update name, email, role, active status, and reset password.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@/lib/types'

export default function EditUserForm({ user }: { user: User }) {
  const router = useRouter()

  const [form, setForm] = useState({
    name:      user.name,
    email:     user.email,
    role:      user.role as 'admin' | 'viewer',
    is_active: user.is_active,
  })
  const [newPassword, setNewPassword] = useState('')
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    setError('')

    const body: Record<string, unknown> = { ...form }
    if (newPassword) {
      if (newPassword.length < 8) {
        setError('Password must be at least 8 characters')
        setSaving(false)
        return
      }
      body.password = newPassword
    }

    const res = await fetch(`/api/admin/users/${user.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const data = await res.json()
    if (data.error) {
      setError(data.error)
    } else {
      setSaved(true)
      setNewPassword('')
      setTimeout(() => setSaved(false), 3000)
    }
    setSaving(false)
  }

  async function handleDelete() {
    setDeleting(true)
    const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' })
    if (res.ok) {
      router.push('/admin/users')
    } else {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Failed to delete user')
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSave} className="card p-6 space-y-4">
        <h2 className="section-title">Account Details</h2>

        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
            Full Name
          </label>
          <input
            className="input"
            required
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
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
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
            <option value="admin">Admin</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>

        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
            Status
          </label>
          <select
            className="input"
            value={form.is_active ? 'active' : 'inactive'}
            onChange={e => setForm(f => ({ ...f, is_active: e.target.value === 'active' }))}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive (cannot sign in)</option>
          </select>
        </div>

        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
            New Password
            <span className="ml-1 font-normal" style={{ color: 'var(--text-faint)' }}>
              — leave blank to keep current
            </span>
          </label>
          <input
            className="input"
            type="password"
            minLength={8}
            placeholder="Enter new password to reset"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
          />
        </div>

        {error && (
          <p className="text-sm" style={{ color: 'var(--red)' }}>{error}</p>
        )}
        {saved && (
          <p className="text-sm" style={{ color: 'var(--green)' }}>Saved ✓</p>
        )}

        <button type="submit" disabled={saving} className="btn btn-primary">
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </form>

      {/* Danger zone */}
      <div className="card p-6">
        <h2 className="section-title mb-1">Danger Zone</h2>
        <p className="section-desc mb-4">Permanently delete this user account.</p>
        {confirmDelete ? (
          <div className="flex items-center gap-3">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Are you sure? This cannot be undone.
            </span>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="btn btn-danger"
            >
              {deleting ? 'Deleting…' : 'Yes, delete'}
            </button>
            <button onClick={() => setConfirmDelete(false)} className="btn btn-secondary">
              Cancel
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="btn btn-danger">
            Delete User
          </button>
        )}
      </div>
    </div>
  )
}
