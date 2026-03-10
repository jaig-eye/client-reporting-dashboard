'use client'

// Profile editing form for regular admin users.
// Supports: display name, email, avatar upload, password change.

import { useState } from 'react'

interface Props {
  userId:           string
  initialName:      string
  initialEmail:     string
  initialAvatarUrl: string
}

export default function ProfileForm({ initialName, initialEmail, initialAvatarUrl }: Props) {
  const [name,      setName]      = useState(initialName)
  const [email,     setEmail]     = useState(initialEmail)
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw,     setNewPw]     = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [status,    setStatus]    = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [errorMsg,  setErrorMsg]  = useState('')
  const [uploading, setUploading] = useState(false)

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('folder', 'avatars')
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const data = await res.json()
      if (data.url) setAvatarUrl(data.url)
      else throw new Error(data.error || 'Upload failed')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed')
      setStatus('error')
    } finally {
      setUploading(false)
    }
  }

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault()
    setStatus('saving')
    setErrorMsg('')
    try {
      const res = await fetch('/api/admin/users/me', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, email, avatar_url: avatarUrl }),
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
    if (newPw !== confirmPw) { setErrorMsg('Passwords do not match'); setStatus('error'); return }
    if (newPw.length < 10)   { setErrorMsg('Password must be at least 10 characters'); setStatus('error'); return }
    setStatus('saving')
    setErrorMsg('')
    try {
      const res = await fetch('/api/admin/users/me/password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ current_password: currentPw, new_password: newPw }),
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

          {/* Avatar */}
          <div>
            <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-muted)' }}>
              Profile Photo
            </label>
            <div className="flex items-center gap-4">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className="h-14 w-14 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div
                  className="h-14 w-14 rounded-full flex items-center justify-center text-white text-lg font-semibold flex-shrink-0"
                  style={{ background: 'var(--blue)' }}
                >
                  {name.charAt(0).toUpperCase() || '?'}
                </div>
              )}
              <div>
                <label className="btn btn-secondary cursor-pointer" style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}>
                  {uploading ? 'Uploading…' : 'Upload Photo'}
                  <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} disabled={uploading} />
                </label>
                <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>JPG, PNG, WebP — max 4MB</p>
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              Display Name
            </label>
            <input className="input" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
          </div>

          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              Email
            </label>
            <input className="input" type="email" placeholder="your@email.com" value={email} onChange={e => setEmail(e.target.value)} />
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
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Current Password</label>
            <input className="input" type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} required />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>New Password</label>
            <input className="input" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} minLength={10} required />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Confirm New Password</label>
            <input className="input" type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} minLength={10} required />
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
          <button type="submit" className="btn btn-danger">Sign Out</button>
        </form>
      </div>
    </div>
  )
}
