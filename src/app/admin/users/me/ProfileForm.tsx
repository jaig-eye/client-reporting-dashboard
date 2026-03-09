'use client'

// Profile editing form.
// Allows updating: display name, email, password, and avatar URL.
// Password change requires current password verification (handled server-side).

import { useState } from 'react'

export default function ProfileForm() {
  const [name,        setName]       = useState('')
  const [email,       setEmail]      = useState('')
  const [avatarUrl,   setAvatarUrl]  = useState('')
  const [currentPw,   setCurrentPw]  = useState('')
  const [newPw,       setNewPw]      = useState('')
  const [confirmPw,   setConfirmPw]  = useState('')
  const [status,      setStatus]     = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [errorMsg,    setErrorMsg]   = useState('')

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault()
    setStatus('saving')
    setErrorMsg('')

    try {
      const res = await fetch('/api/admin/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:       name       || undefined,
          email:      email      || undefined,
          avatar_url: avatarUrl  || undefined,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to save')
      }
      setStatus('success')
      setTimeout(() => setStatus('idle'), 3000)
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault()
    if (newPw !== confirmPw) { setErrorMsg('Passwords do not match'); return }
    if (newPw.length < 10)   { setErrorMsg('Password must be at least 10 characters'); return }

    setStatus('saving')
    setErrorMsg('')

    try {
      const res = await fetch('/api/admin/users/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to change password')
      }
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
      setStatus('success')
      setTimeout(() => setStatus('idle'), 3000)
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div className="space-y-6">
      {/* Status notice */}
      {status === 'success' && (
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'var(--green-subtle)', border: '1px solid #bbf7d0', color: 'var(--green)' }}>
          Saved successfully.
        </div>
      )}
      {status === 'error' && errorMsg && (
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'var(--red-subtle)', border: '1px solid #fecaca', color: 'var(--red)' }}>
          {errorMsg}
        </div>
      )}

      {/* Profile info */}
      <form onSubmit={handleProfileSave} className="card p-6">
        <h2 className="section-title mb-4">Profile Information</h2>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              Display Name
            </label>
            <input
              className="input"
              placeholder="Your name"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              Email
            </label>
            <input
              className="input"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              Avatar URL
            </label>
            <input
              className="input"
              placeholder="https://..."
              value={avatarUrl}
              onChange={e => setAvatarUrl(e.target.value)}
            />
            <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
              Link to a profile image. Leave blank to use initials.
            </p>
          </div>
        </div>
        <div className="mt-4">
          <button type="submit" className="btn btn-primary" disabled={status === 'saving'}>
            {status === 'saving' ? 'Saving…' : 'Save Profile'}
          </button>
        </div>
      </form>

      {/* Password change */}
      <form onSubmit={handlePasswordChange} className="card p-6">
        <h2 className="section-title mb-1">Change Password</h2>
        <p className="section-desc mb-4">Minimum 10 characters.</p>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              Current Password
            </label>
            <input
              className="input"
              type="password"
              value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              New Password
            </label>
            <input
              className="input"
              type="password"
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              minLength={10}
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              Confirm New Password
            </label>
            <input
              className="input"
              type="password"
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              minLength={10}
              required
            />
          </div>
        </div>
        <div className="mt-4">
          <button type="submit" className="btn btn-primary" disabled={status === 'saving'}>
            {status === 'saving' ? 'Changing…' : 'Change Password'}
          </button>
        </div>
      </form>

      {/* Sign out */}
      <div className="card p-6">
        <h2 className="section-title mb-1">Sign Out</h2>
        <p className="section-desc mb-4">Sign out of this admin session.</p>
        <form action="/api/auth/admin-logout" method="POST">
          <button type="submit" className="btn btn-danger">
            Sign Out
          </button>
        </form>
      </div>
    </div>
  )
}
